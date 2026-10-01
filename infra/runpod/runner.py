"""One-job Runpod GPU runners for laya-jp training (adapted from plenoai/pleno-anonymize-demo).

Credentials live on the GitHub-hosted control plane only:
  RUNPOD_API_KEY   pod-capable RunPod personal API key (not the serverless key)
  GH_TOKEN         GitHub App token with repository administration
"""
import argparse
import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

RUNPOD = "https://api.runpod.io/v2"
GITHUB = "https://api.github.com"
# CUDA 13.0.2 base Ubuntu 24.04; torch wheels come from pip during the GPU job.
IMAGE = "nvidia/cuda@sha256:2ab6381d970b211fb93853796dc6707eb8a72575a375c422b17cf4d8b2641701"
MIN_CUDA = "13.0"
MIN_MEMORY = int(os.environ.get("RUNPOD_MIN_MEMORY", "16"))


def request(base, path, method="GET", body=None):
    token = os.environ["RUNPOD_API_KEY" if base == RUNPOD else "GH_TOKEN"]
    req = Request(
        base + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "jev-kitchen-runpod-runner/1.0",
            "Accept": "application/json",
        },
        method=method,
    )
    with urlopen(req, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def pages(base, path, key):
    cursor = None
    while True:
        query = "?" + urlencode({"cursor": cursor}) if cursor else ""
        result = request(base, path + query)
        yield from result[key]
        if not result.get("pagination", {}).get("hasNextPage"):
            return
        cursor = result["pagination"]["nextCursor"]
        if not cursor:
            raise RuntimeError("Pagination reports more pages without a cursor")


def candidates(gpus, maximum, cloud="SECURE"):
    # Lowest hourly rate, not throughput; mmBERT-base fine-tune needs ~16GB.
    return sorted(
        (
            gpu
            for gpu in gpus
            if gpu.get("manufacturer") == "NVIDIA"
            and gpu["memory"] >= MIN_MEMORY
            and gpu.get("availability") in {"LOW", "MEDIUM", "HIGH"}
            and 0 < (gpu.get("price", {}).get(cloud.lower()) or 0) <= maximum
        ),
        key=lambda gpu: (gpu["price"][cloud.lower()], gpu["id"]),
    )


def delete(base, path):
    for attempt in range(3):
        try:
            request(base, path, "DELETE")
            return
        except HTTPError as error:
            if error.code == 404:
                return
            if error.code < 500 and error.code != 429:
                raise
            if attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))


def cleanup(repo, run=None):
    prefix = f"gha-{repo.replace('/', '-')}-"
    pattern = re.compile(re.escape(prefix) + r"[0-9]+-[0-9]+")
    for pod in pages(RUNPOD, "/pods", "pods"):
        name = pod.get("name", "")
        if not pattern.fullmatch(name) or (run and name != prefix + run):
            continue
        created = datetime.fromisoformat(pod["createdAt"].replace("Z", "+00:00"))
        if run or (datetime.now(UTC) - created).total_seconds() > 7200:
            delete(RUNPOD, f"/pods/{pod['id']}")
            print(f"Deleted Pod {pod['id']} ({name})", flush=True)
    page = 1
    while True:
        runners = request(GITHUB, f"/repos/{repo}/actions/runners?per_page=100&page={page}")
        for runner in runners["runners"]:
            name = runner["name"]
            if pattern.fullmatch(name) and run and name == prefix + run:
                delete(GITHUB, f"/repos/{repo}/actions/runners/{runner['id']}")
        if len(runners["runners"]) < 100:
            break
        page += 1


def provision(body, maximum):
    last_rejection = None
    for cloud in ("SECURE", "COMMUNITY"):
        gpus = request(
            RUNPOD,
            f"/catalog/gpus?include=AVAILABILITY&product=POD&cloud={cloud}&minCudaVersion={MIN_CUDA}",
        )["gpus"]
        eligible = candidates(gpus, maximum, cloud)
        print(f"{cloud}: {len(gpus)} catalog GPUs, {len(eligible)} eligible", flush=True)
        for gpu in eligible:
            deployment = {
                **body,
                "cloud": cloud,
                "gpu": {"id": gpu["id"], "count": 1, "minCudaVersion": MIN_CUDA},
            }
            try:
                pod = request(RUNPOD, "/pods", "POST", deployment)
            except HTTPError as error:
                if error.code not in {400, 403}:
                    raise
                last_rejection = error
                print(f"Rejected {cloud} {gpu['id']} (HTTP {error.code}); next candidate", flush=True)
                continue
            print(
                f"Pod {pod['id']}: {cloud} {gpu['id']}, "
                f"quoted GPU price ${gpu['price'][cloud.lower()]}/h",
                flush=True,
            )
            return pod
    raise RuntimeError(
        f"No eligible >= {MIN_MEMORY}GB NVIDIA GPU could be placed within "
        f"${maximum}/GPU-hour in Secure or Community Cloud"
    ) from last_rejection


def start(repo, run, maximum):
    name = f"gha-{repo.replace('/', '-')}-{run}"
    jit = request(
        GITHUB,
        f"/repos/{repo}/actions/runners/generate-jitconfig",
        "POST",
        {"name": name, "runner_group_id": 1, "labels": ["self-hosted", "linux", "x64", name]},
    )
    print(f"::add-mask::{jit['encoded_jit_config']}")
    body = {
        "name": name,
        "image": IMAGE,
        "disk": 40,
        "ports": [],
        "entrypoint": ["/bin/bash", "-c"],
        "cmd": [Path(__file__).with_name("bootstrap.sh").read_text()],
        "env": {"RUNNER_JIT_CONFIG": jit["encoded_jit_config"]},
    }
    try:
        pod = provision(body, maximum)
        if pod["cost"] > maximum + 0.02:
            raise RuntimeError(f"Pod rate ${pod['cost']}/h exceeds budget")
        deadline = time.monotonic() + 420
        while time.monotonic() < deadline:
            runner = request(GITHUB, f"/repos/{repo}/actions/runners/{jit['runner']['id']}")
            if runner["status"] == "online":
                print(f"Runner ready: {name}")
                return
            time.sleep(10)
        raise TimeoutError("Runner did not connect within seven minutes")
    except BaseException:
        cleanup(repo, run)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "reap"])
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument("--run", help="GitHub run ID-attempt")
    parser.add_argument("--max-price", type=float, default=0.50)
    args = parser.parse_args()
    if not args.repo or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        parser.error("--repo must be owner/repository")
    if args.action != "reap" and (not args.run or not re.fullmatch(r"[0-9]+-[0-9]+", args.run)):
        parser.error("--run must be numeric run ID-attempt")
    if not 0 < args.max_price <= 1:
        parser.error("--max-price must be greater than zero and at most $1/hour")
    if args.action == "start":
        start(args.repo, args.run, args.max_price)
    else:
        cleanup(args.repo, args.run if args.action == "stop" else None)


if __name__ == "__main__":
    main()