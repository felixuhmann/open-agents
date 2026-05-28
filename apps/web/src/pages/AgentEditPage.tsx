import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  BrainIcon,
  CloudArrowUpIcon,
  FloppyDiskIcon,
  IdentificationCardIcon,
  ImageIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  TrashIcon,
  WarningOctagonIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import {
  avatarSrc,
  type FullAgentDto,
  useAgent,
  useAgentAccess,
  useSkills,
  useTools,
} from "@/lib/queries";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * Anthropic models we expose to admins. Mirrors `AgentModel` in
 * `packages/types/src/agents.ts` (kept literal here to avoid pulling
 * Zod into the bundle just for an enum). Keep these in lock-step.
 */
const MODEL_OPTIONS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    hint: "Best quality, highest cost. Default.",
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    hint: "Previous Opus generation.",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    hint: "Strong general-purpose model, lower cost than Opus.",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "Fastest and cheapest, smaller context window.",
  },
];

type EditState = {
  displayName: string;
  description: string;
  systemPrompt: string;
  model: string;
  emailEnabled: boolean;
  webEnabled: boolean;
  accessMode: "everyone" | "specific";
  accessUserIds: string[];
  inboundLocalPart: string;
  toolIds: string[];
  skillBindings: Array<{ skillId: string; skillVersionId: string }>;
  thirdPartyMcp: Array<{
    id?: string;
    label: string;
    serverUrl: string;
    /** Set only when the operator enters or clears a bearer token. */
    bearer?: string;
  }>;
  sandboxInternetEnabled: boolean;
  sandboxAllowList: string;
  sandboxProtectInternalNetwork: boolean;
  sandboxDenyRules: string;
  sandboxApprovalGates: string;
  sandboxMaxRuntimeSeconds: number;
  sandboxMaxOutputChars: number;
  sandboxMaxBackgroundLifetimeSeconds: number;
};

function fromDto(a: FullAgentDto): EditState {
  return {
    displayName: a.displayName,
    description: a.description ?? "",
    systemPrompt: a.systemPrompt,
    model: a.model,
    emailEnabled: a.emailEnabled,
    webEnabled: a.webEnabled,
    accessMode: a.accessMode,
    accessUserIds: a.accessUserIds,
    inboundLocalPart: a.inboundLocalPart,
    toolIds: a.toolBindings.map((b) => b.toolId),
    skillBindings:
      a.skillBindings ??
      a.skills.map((s) => ({ skillId: s.id, skillVersionId: s.versionId })),
    thirdPartyMcp: a.thirdPartyMcp.map((m) => ({
      id: m.id,
      label: m.label,
      serverUrl: m.serverUrl,
    })),
    sandboxInternetEnabled: a.sandboxNetworkPolicy.internetEnabled,
    sandboxAllowList: a.sandboxNetworkPolicy.allowList,
    sandboxProtectInternalNetwork: a.sandboxNetworkPolicy.protectInternalNetwork,
    sandboxDenyRules: a.sandboxCommandPolicy.denyRules.join("\n"),
    sandboxApprovalGates: a.sandboxCommandPolicy.approvalGatePatterns.join("\n"),
    sandboxMaxRuntimeSeconds: a.sandboxCommandPolicy.maxRuntimeSeconds,
    sandboxMaxOutputChars: a.sandboxCommandPolicy.maxOutputChars,
    sandboxMaxBackgroundLifetimeSeconds:
      a.sandboxCommandPolicy.maxBackgroundProcessLifetimeSeconds,
  };
}

function linesToPatterns(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function AgentEditPage() {
  const { slug } = useParams<{ slug: string }>();
  const agent = useAgent(slug);
  const tools = useTools();
  const skills = useSkills();
  const access = useAgentAccess(slug);
  const qc = useQueryClient();
  const [state, setState] = useState<EditState | null>(null);
  const [accessQuery, setAccessQuery] = useState("");

  useEffect(() => {
    if (agent.data) setState(fromDto(agent.data));
  }, [agent.data]);

  const saveMutation = useMutation({
    mutationFn: (s: EditState) =>
      api<FullAgentDto>(`/api/agents/${slug}`, {
        method: "PATCH",
        json: {
          displayName: s.displayName,
          description: s.description || null,
          systemPrompt: s.systemPrompt,
          model: s.model,
          emailEnabled: s.emailEnabled,
          webEnabled: s.webEnabled,
          accessMode: s.accessMode,
          accessUserIds: s.accessUserIds,
          inboundLocalPart: s.inboundLocalPart,
          toolBindings: s.toolIds.map((id) => ({ toolId: id })),
          skillBindings: s.skillBindings,
          thirdPartyMcp: s.thirdPartyMcp.map((m) => ({
            id: m.id,
            label: m.label,
            serverUrl: m.serverUrl,
            ...(m.bearer !== undefined ? { bearer: m.bearer } : {}),
          })),
          sandboxNetworkPolicy: {
            internetEnabled: s.sandboxInternetEnabled,
            allowList: s.sandboxAllowList.trim(),
            protectInternalNetwork: s.sandboxProtectInternalNetwork,
          },
          sandboxCommandPolicy: {
            denyRules: linesToPatterns(s.sandboxDenyRules),
            approvalGatePatterns: linesToPatterns(s.sandboxApprovalGates),
            maxRuntimeSeconds: s.sandboxMaxRuntimeSeconds,
            maxOutputChars: s.sandboxMaxOutputChars,
            maxBackgroundProcessLifetimeSeconds: s.sandboxMaxBackgroundLifetimeSeconds,
          },
        },
      }),
    onSuccess: async () => {
      toast.success("Agent saved");
      await qc.invalidateQueries({ queryKey: ["agents", slug] });
      await qc.invalidateQueries({ queryKey: ["agents", slug, "access"] });
    },
    onError: (e) =>
      toast.error("Save failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/agents/${slug}/avatar`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(r.status, body.error ?? r.statusText);
      }
      return (await r.json()) as FullAgentDto;
    },
    onSuccess: async () => {
      toast.success("Profile picture updated");
      await qc.invalidateQueries({ queryKey: ["agents", slug] });
      await qc.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (e) =>
      toast.error("Upload failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const removeAvatar = useMutation({
    mutationFn: () => api(`/api/agents/${slug}/avatar`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Profile picture removed");
      await qc.invalidateQueries({ queryKey: ["agents", slug] });
      await qc.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (e) =>
      toast.error("Couldn't remove", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      api<FullAgentDto>(`/api/agents/${slug}/publish`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Version published", {
        description: "The frozen config is now live for new runs.",
      });
      await qc.invalidateQueries({ queryKey: ["agents", slug] });
    },
    onError: (e) =>
      toast.error("Publish failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  if (agent.isLoading || !state) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!agent.data) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningOctagonIcon />
          </EmptyMedia>
          <EmptyTitle>Agent not found</EmptyTitle>
          <EmptyDescription>That slug doesn&apos;t map to an agent.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const setS = (patch: Partial<EditState>) => setState({ ...state, ...patch });
  const emailAddress = `${state.inboundLocalPart || slug || "slug"}@${
    agent.data.mailgunDomain ?? "your email domain"
  }`;
  const accessUsers = access.data?.users ?? [];
  const visibleAccessUsers = accessUsers.filter((person) => {
    const query = accessQuery.trim().toLowerCase();
    if (!query) return true;
    return `${person.name ?? ""} ${person.email}`.toLowerCase().includes(query);
  });
  const selectedAccessIds = new Set(state.accessUserIds);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Edit ${agent.data.displayName}`}
        meta={agent.data.slug}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link to={`/agents/${slug}`}>
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Link>
            </Button>
            <Button
              variant="outline"
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
            >
              {publishMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CloudArrowUpIcon data-icon="inline-start" />
              )}
              {publishMutation.isPending ? "Publishing…" : "Publish new version"}
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(state)}
            >
              {saveMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FloppyDiskIcon data-icon="inline-start" />
              )}
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IdentificationCardIcon className="size-4" weight="duotone" />
            Identity
          </CardTitle>
          <CardDescription>
            How the agent appears to users in the UI and on inbound email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>Profile picture</FieldLabel>
              <div className="flex items-center gap-4">
                <Avatar size="lg">
                  {agent.data.avatar ? (
                    <AvatarImage
                      src={avatarSrc(agent.data.avatar)}
                      alt={agent.data.displayName}
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {agent.data.displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadAvatar.mutate(file);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadAvatar.isPending}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadAvatar.isPending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <ImageIcon data-icon="inline-start" />
                      )}
                      {agent.data.avatar ? "Replace" : "Upload"}
                    </Button>
                    {agent.data.avatar ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={removeAvatar.isPending}
                        onClick={() => removeAvatar.mutate()}
                      >
                        {removeAvatar.isPending ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <TrashIcon data-icon="inline-start" />
                        )}
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <FieldDescription>
                    PNG, JPG, GIF, WebP, or SVG up to 5 MB. Shown in the agent list, the
                    chat header, and the email reply header.
                  </FieldDescription>
                </div>
              </div>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                <Input
                  id="display-name"
                  value={state.displayName}
                  onChange={(e) => setS({ displayName: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="local-part">Email slug</FieldLabel>
                <Input
                  id="local-part"
                  className="font-mono"
                  value={state.inboundLocalPart}
                  onChange={(e) => setS({ inboundLocalPart: e.target.value })}
                />
                <FieldDescription>{emailAddress}</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea
                id="description"
                rows={2}
                value={state.description}
                onChange={(e) => setS({ description: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="system-prompt">System prompt</FieldLabel>
              <Textarea
                id="system-prompt"
                rows={10}
                className="font-mono text-xs"
                value={state.systemPrompt}
                onChange={(e) => setS({ systemPrompt: e.target.value })}
              />
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Surfaces &amp; access</FieldLegend>
              <Field orientation="horizontal">
                <Switch
                  id="web-enabled"
                  checked={state.webEnabled}
                  onCheckedChange={(v) => setS({ webEnabled: v })}
                />
                <FieldContent>
                  <FieldLabel htmlFor="web-enabled">Web chat enabled</FieldLabel>
                  <FieldDescription>
                    Exposes <code>/agents/{state.inboundLocalPart || slug}/chat</code>
                  </FieldDescription>
                </FieldContent>
              </Field>
              <Field orientation="horizontal">
                <Switch
                  id="email-enabled"
                  checked={state.emailEnabled}
                  onCheckedChange={(v) => setS({ emailEnabled: v })}
                />
                <FieldContent>
                  <FieldLabel htmlFor="email-enabled">Email enabled</FieldLabel>
                  <FieldDescription>Receives mail at {emailAddress}.</FieldDescription>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="access-mode">Access</FieldLabel>
                <Select
                  value={state.accessMode}
                  onValueChange={(v) =>
                    setS({ accessMode: v as "everyone" | "specific" })
                  }
                >
                  <SelectTrigger id="access-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="everyone">Everyone in org</SelectItem>
                      <SelectItem value="specific">Specific users</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {state.accessMode === "specific" ? (
                <Field>
                  <FieldLabel htmlFor="access-search">People</FieldLabel>
                  <div className="flex h-8 items-center gap-2 border border-input px-2.5">
                    <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
                    <Input
                      id="access-search"
                      data-access-search
                      placeholder="Search people"
                      className="h-7 border-0 px-0 focus-visible:ring-0"
                      value={accessQuery}
                      onChange={(e) => setAccessQuery(e.target.value)}
                    />
                  </div>
                  <div
                    data-access-list
                    className="flex max-h-64 flex-col overflow-auto border border-border"
                  >
                    {access.isLoading ? (
                      <div className="p-3 text-sm text-muted-foreground">
                        Loading people…
                      </div>
                    ) : visibleAccessUsers.length > 0 ? (
                      visibleAccessUsers.map((person) => {
                        const checked = selectedAccessIds.has(person.id);
                        const label = person.name ?? person.email;
                        return (
                          <Field
                            key={person.id}
                            orientation="horizontal"
                            className="border-b border-border px-3 py-2 last:border-b-0"
                            data-checked={checked}
                          >
                            <Checkbox
                              id={`access-${person.id}`}
                              checked={checked}
                              onCheckedChange={(v) => {
                                const next = new Set(state.accessUserIds);
                                if (v === true) next.add(person.id);
                                else next.delete(person.id);
                                setS({ accessUserIds: [...next] });
                              }}
                            />
                            <FieldContent>
                              <FieldLabel htmlFor={`access-${person.id}`}>
                                <FieldTitle>{label}</FieldTitle>
                              </FieldLabel>
                              <FieldDescription>{person.email}</FieldDescription>
                            </FieldContent>
                          </Field>
                        );
                      })
                    ) : (
                      <div className="p-3 text-sm text-muted-foreground">
                        No people found.
                      </div>
                    )}
                  </div>
                </Field>
              ) : null}
            </FieldSet>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainIcon className="size-4" weight="duotone" />
            Model
          </CardTitle>
          <CardDescription>
            Which model powers the agent at runtime. Publish a new version to apply
            changes to live runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="model">Model</FieldLabel>
            <Select value={state.model} onValueChange={(v) => setS({ model: v })}>
              <SelectTrigger id="model" className="w-full sm:w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              {MODEL_OPTIONS.find((m) => m.id === state.model)?.hint ??
                "Custom model id — must match a model id Anthropic accepts."}
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WrenchIcon className="size-4" weight="duotone" />
            Role tools
          </CardTitle>
          <CardDescription>Capabilities the agent can call.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {tools.data?.length ? (
            <CheckboxGrid
              items={(tools.data ?? [])
                .filter((t) => !t.deprecated || state.toolIds.includes(t.id))
                .map((t) => ({
                  id: t.id,
                  title: t.name,
                  description: t.description,
                }))}
              selected={state.toolIds}
              onToggle={(id, on) => {
                const next = new Set(state.toolIds);
                if (on) next.add(id);
                else next.delete(id);
                setS({ toolIds: [...next] });
              }}
            />
          ) : (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WrenchIcon />
                </EmptyMedia>
                <EmptyTitle>No tools available</EmptyTitle>
                <EmptyDescription>
                  Restart the API so <code>seedToolCatalog()</code> can populate the
                  catalog.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PuzzlePieceIcon className="size-4" weight="duotone" />
            Skills
          </CardTitle>
          <CardDescription>Skill bundles uploaded in the Skills library.</CardDescription>
        </CardHeader>
        <CardContent>
          {skills.data?.length ? (
            <div data-slot="checkbox-group" className="grid gap-3 md:grid-cols-2">
              {skills.data.map((skill) => {
                const binding = state.skillBindings.find((b) => b.skillId === skill.id);
                const checked = Boolean(binding);
                const versionId = binding?.skillVersionId ?? skill.latestVersionId ?? "";
                return (
                  <Field
                    key={skill.id}
                    orientation="horizontal"
                    data-checked={checked}
                    className="items-start"
                  >
                    <Checkbox
                      id={`skill-${skill.id}`}
                      checked={checked}
                      disabled={!skill.latestVersionId}
                      onCheckedChange={(v) => {
                        const on = v === true;
                        if (!on) {
                          setS({
                            skillBindings: state.skillBindings.filter(
                              (b) => b.skillId !== skill.id,
                            ),
                          });
                          return;
                        }
                        if (!skill.latestVersionId) return;
                        setS({
                          skillBindings: [
                            ...state.skillBindings.filter((b) => b.skillId !== skill.id),
                            {
                              skillId: skill.id,
                              skillVersionId: skill.latestVersionId,
                            },
                          ],
                        });
                      }}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`skill-${skill.id}`}>
                        <FieldTitle>{skill.name}</FieldTitle>
                      </FieldLabel>
                      {skill.description ? (
                        <FieldDescription>{skill.description}</FieldDescription>
                      ) : null}
                    </FieldContent>
                    {checked ? (
                      <Select
                        value={versionId}
                        onValueChange={(nextVersionId) =>
                          setS({
                            skillBindings: state.skillBindings.map((b) =>
                              b.skillId === skill.id
                                ? { ...b, skillVersionId: nextVersionId }
                                : b,
                            ),
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="ml-auto w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {skill.versions.map((version) => (
                              <SelectItem key={version.id} value={version.id}>
                                v{version.versionNumber}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : null}
                  </Field>
                );
              })}
            </div>
          ) : (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PuzzlePieceIcon />
                </EmptyMedia>
                <EmptyTitle>No skills uploaded</EmptyTitle>
                <EmptyDescription>
                  <Link
                    to="/library/skills"
                    className="underline underline-offset-4 hover:text-primary"
                  >
                    Upload one in the library
                  </Link>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4" weight="duotone" />
            Sandbox security
          </CardTitle>
          <CardDescription>
            Default network and command policy for Daytona sandboxes. Publish a new
            version so runs pick up changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Network</FieldLegend>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="sandbox-internet">Internet access</FieldLabel>
                  <FieldDescription>
                    When off, outbound traffic from the sandbox is blocked.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="sandbox-internet"
                  checked={state.sandboxInternetEnabled}
                  onCheckedChange={(checked) => setS({ sandboxInternetEnabled: checked })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sandbox-allowlist">Egress allow list</FieldLabel>
                <Textarea
                  id="sandbox-allowlist"
                  className="font-mono text-sm"
                  rows={3}
                  placeholder="208.80.154.232/32, 10.0.0.0/8"
                  disabled={!state.sandboxInternetEnabled}
                  value={state.sandboxAllowList}
                  onChange={(e) => setS({ sandboxAllowList: e.target.value })}
                />
                <FieldDescription>
                  Comma-separated IPv4 CIDR blocks (max 10). Leave empty for unrestricted
                  egress when the internet is on (subject to your Daytona org tier).
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="sandbox-internal">
                    Protect internal networks
                  </FieldLabel>
                  <FieldDescription>
                    Block shell commands that target private, loopback, or link-local
                    addresses when the internet is enabled.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="sandbox-internal"
                  checked={state.sandboxProtectInternalNetwork}
                  disabled={!state.sandboxInternetEnabled}
                  onCheckedChange={(checked) =>
                    setS({ sandboxProtectInternalNetwork: checked })
                  }
                />
              </Field>
            </FieldSet>
            <FieldSet>
              <FieldLegend>Commands</FieldLegend>
              <Field>
                <FieldLabel htmlFor="sandbox-deny">Deny rules</FieldLabel>
                <Textarea
                  id="sandbox-deny"
                  className="font-mono text-sm"
                  rows={4}
                  placeholder="sudo\s+"
                  value={state.sandboxDenyRules}
                  onChange={(e) => setS({ sandboxDenyRules: e.target.value })}
                />
                <FieldDescription>
                  One JavaScript regex per line (case-insensitive). Built-in destructive
                  patterns always apply.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="sandbox-approval">Approval gates</FieldLabel>
                <Textarea
                  id="sandbox-approval"
                  className="font-mono text-sm"
                  rows={3}
                  placeholder="docker\s+run"
                  value={state.sandboxApprovalGates}
                  onChange={(e) => setS({ sandboxApprovalGates: e.target.value })}
                />
                <FieldDescription>
                  Matching commands are blocked until operator approval is implemented.
                </FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="sandbox-max-runtime">
                    Max runtime (seconds)
                  </FieldLabel>
                  <Input
                    id="sandbox-max-runtime"
                    type="number"
                    min={1}
                    max={3600}
                    value={state.sandboxMaxRuntimeSeconds}
                    onChange={(e) =>
                      setS({
                        sandboxMaxRuntimeSeconds: Number(e.target.value) || 60,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sandbox-max-output">Max output (chars)</FieldLabel>
                  <Input
                    id="sandbox-max-output"
                    type="number"
                    min={1000}
                    max={500000}
                    value={state.sandboxMaxOutputChars}
                    onChange={(e) =>
                      setS({
                        sandboxMaxOutputChars: Number(e.target.value) || 20_000,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sandbox-max-bg">
                    Max background lifetime (s)
                  </FieldLabel>
                  <Input
                    id="sandbox-max-bg"
                    type="number"
                    min={1}
                    max={86400}
                    value={state.sandboxMaxBackgroundLifetimeSeconds}
                    onChange={(e) =>
                      setS({
                        sandboxMaxBackgroundLifetimeSeconds:
                          Number(e.target.value) || 600,
                      })
                    }
                  />
                  <FieldDescription>Async session command ceiling.</FieldDescription>
                </Field>
              </div>
            </FieldSet>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudArrowUpIcon className="size-4" weight="duotone" />
            Third-party MCP servers
          </CardTitle>
          <CardDescription>
            Remote MCP servers for this agent. With Daytona, the orchestrator connects on
            each run; with Anthropic Managed Agents, the hosted sandbox connects directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {state.thirdPartyMcp.length === 0 ? (
              <p className="text-sm text-muted-foreground">No servers configured.</p>
            ) : (
              state.thirdPartyMcp.map((m, idx) => (
                <Field key={m.id ?? idx} orientation="responsive" className="items-end">
                  <FieldContent>
                    <FieldLabel htmlFor={`mcp-label-${idx}`}>Label</FieldLabel>
                    <Input
                      id={`mcp-label-${idx}`}
                      placeholder="my-server"
                      value={m.label}
                      onChange={(e) => {
                        const next = [...state.thirdPartyMcp];
                        next[idx] = { ...m, label: e.target.value };
                        setS({ thirdPartyMcp: next });
                      }}
                    />
                  </FieldContent>
                  <FieldContent>
                    <FieldLabel htmlFor={`mcp-url-${idx}`}>Server URL</FieldLabel>
                    <Input
                      id={`mcp-url-${idx}`}
                      placeholder="https://…"
                      className="font-mono"
                      value={m.serverUrl}
                      onChange={(e) => {
                        const next = [...state.thirdPartyMcp];
                        next[idx] = { ...m, serverUrl: e.target.value };
                        setS({ thirdPartyMcp: next });
                      }}
                    />
                  </FieldContent>
                  <FieldContent>
                    <FieldLabel htmlFor={`mcp-bearer-${idx}`}>Bearer token</FieldLabel>
                    <Input
                      id={`mcp-bearer-${idx}`}
                      type="password"
                      autoComplete="off"
                      placeholder={m.id ? "Leave blank to keep stored token" : "Optional"}
                      value={m.bearer ?? ""}
                      onChange={(e) => {
                        const next = [...state.thirdPartyMcp];
                        next[idx] = { ...m, bearer: e.target.value };
                        setS({ thirdPartyMcp: next });
                      }}
                    />
                  </FieldContent>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    aria-label="Remove MCP server"
                    onClick={() =>
                      setS({
                        thirdPartyMcp: state.thirdPartyMcp.filter((_, i) => i !== idx),
                      })
                    }
                  >
                    <TrashIcon />
                  </Button>
                </Field>
              ))
            )}
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() =>
                setS({
                  thirdPartyMcp: [...state.thirdPartyMcp, { label: "", serverUrl: "" }],
                })
              }
            >
              <PlusIcon data-icon="inline-start" />
              Add MCP server
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}

function CheckboxGrid({
  items,
  selected,
  onToggle,
}: {
  items: Array<{ id: string; title: string; description?: string }>;
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <div data-slot="checkbox-group" className="grid gap-3 md:grid-cols-2">
      {items.map((item) => {
        const checked = selected.includes(item.id);
        return (
          <Field key={item.id} orientation="horizontal" data-checked={checked}>
            <Checkbox
              id={`opt-${item.id}`}
              checked={checked}
              onCheckedChange={(v) => onToggle(item.id, v === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor={`opt-${item.id}`}>
                <FieldTitle>{item.title}</FieldTitle>
              </FieldLabel>
              {item.description ? (
                <FieldDescription>{item.description}</FieldDescription>
              ) : null}
            </FieldContent>
          </Field>
        );
      })}
    </div>
  );
}
