# OpenSandbox on k3s with Kata

This is the verified deployment path for running Open Agents workloads in OpenSandbox-created Kata VMs. Docker-mode OpenSandbox is not accepted for production because its host-side `dns+nft` sidecar does not form a reliable enforcement boundary around Kata tap traffic.

## Verified versions

- k3s: `v1.36.2+k3s1`
- Kata Containers: `3.32.0`
- OpenSandbox source/chart: tag `server/v0.2.2`
- OpenSandbox server: `v0.2.2`
- OpenSandbox controller: `v0.2.0`
- execd: `v1.0.21`
- egress: `v1.1.4` with the repository hard-deny overlay
- Node SDK: `@alibaba-group/opensandbox@0.1.10` (exact pin)
- RuntimeClass: `kata-qemu` -> `io.containerd.kata.v2`

## Security properties

- Each BatchSandbox pod uses `runtimeClassName: kata-qemu`.
- The guest and egress sidecar share one KVM-backed Kata VM.
- Sandbox pods set `automountServiceAccountToken: false`.
- Guests receive no Docker/containerd socket, kubeconfig, or Kubernetes token.
- OpenSandbox API authentication is mandatory and sourced from a Secret.
- The API Service is ClusterIP-only.
- Egress is `dns+nft`; hard-deny ranges precede dynamic allow entries.
- Unsupported application IP/CIDR allowlist entries fail closed.

## Prerequisites

1. Install Kata 3.32 and verify `/dev/kvm` plus a real guest workload.
2. Install k3s `v1.36.2+k3s1` with Traefik and ServiceLB disabled.
3. Register a k3s containerd runtime handler named `kata-qemu` with runtime type `io.containerd.kata.v2`.
4. Apply `kubernetes/opensandbox/runtimeclass.yaml`.
5. Build the guest and hardened egress images, then import them into k3s containerd:

```bash
docker save open-agents-opensandbox-guest:1.0.0 \
  open-agents-opensandbox-egress:1.1.4-hardened \
  | sudo k3s ctr images import -
```

## Install

Fetch the exact audited chart source:

```bash
git clone --depth 1 --branch server/v0.2.2 \
  https://github.com/opensandbox-group/OpenSandbox.git /opt/opensandbox-v0.2.2
helm dependency build /opt/opensandbox-v0.2.2/kubernetes/charts/opensandbox
```

Create namespaces and the API-key Secret without putting the key in Git:

```bash
sudo k3s kubectl create namespace opensandbox-system --dry-run=client -o yaml | sudo k3s kubectl apply -f -
sudo k3s kubectl create namespace opensandbox --dry-run=client -o yaml | sudo k3s kubectl apply -f -
sudo k3s kubectl -n opensandbox-system create secret generic opensandbox-api-key \
  --from-literal=api-key="$OPENSANDBOX_API_KEY" --dry-run=client -o yaml \
  | sudo k3s kubectl apply -f -
sudo k3s kubectl apply -f kubernetes/opensandbox/runtimeclass.yaml
sudo k3s kubectl apply -f kubernetes/opensandbox/pvc.yaml
```

Render, lint, and install:

```bash
helm lint /opt/opensandbox-v0.2.2/kubernetes/charts/opensandbox \
  -f kubernetes/opensandbox/values.yaml
sudo env KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm upgrade --install opensandbox \
  /opt/opensandbox-v0.2.2/kubernetes/charts/opensandbox \
  --namespace opensandbox-system \
  -f kubernetes/opensandbox/values.yaml
sudo k3s kubectl -n opensandbox-system rollout status deploy/opensandbox-controller-manager --timeout=120s
sudo k3s kubectl -n opensandbox-system rollout status deploy/opensandbox-server --timeout=120s
```

Applications running in the cluster use:

```text
http://opensandbox-server.opensandbox-system.svc.cluster.local
```

Do not expose the OpenSandbox API publicly. A local port-forward is acceptable only for verification.

## Required live verification

Configuration alone is insufficient. Create a sandbox through the pinned SDK and verify:

```bash
sudo k3s kubectl -n opensandbox get batchsandbox,pod
sudo k3s kubectl -n opensandbox get pod <sandbox-id>-0 \
  -o jsonpath='{.spec.runtimeClassName}{"\n"}'
ps -eo pid,args | grep '[q]emu-system'
```

The guest must report the Kata guest kernel, not the host kernel. Also test authentication, streaming, timeout, cancellation, upload/download, control-plane restart recovery, default deny, domain allow, metadata/private/direct-IP denial, DNS rebinding, and UDP/443.

## Pause/resume limitation

The checked-in values intentionally disable root-filesystem snapshots. Native Kubernetes pause/resume requires:

- an authenticated OCI snapshot registry reachable both from commit Jobs and k3s containerd;
- the image-committer image;
- the k3s containerd socket mounted only into snapshot commit Jobs;
- registry credentials and a k3s registry mirror configuration.

The bundled chart passes snapshot flags that the published `opensandbox/controller:v0.2.0` image rejected during live verification. Do **not** enable snapshots with that image. Build the controller and image-committer from the exact audited source tag, pin their digests, configure the registry, and pass a live pause/resume persistence test first. The repository default lifecycle sets `autoStopInterval = -1`, so automatic provider
pause is disabled until this path is verified. Do not use manual archive/pause in
that deployment. Ordinary running-sandbox persistence and server/controller
restart recovery are verified.
