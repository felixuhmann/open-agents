import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReasoningLevel } from "@open-agents/types";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  BrainIcon,
  CloudArrowUpIcon,
  FloppyDiskIcon,
  IdentificationCardIcon,
  ImageIcon,
  MagnifyingGlassIcon,
  PlugsConnectedIcon,
  PlusIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  TrashIcon,
  UsersThreeIcon,
  WarningIcon,
  WarningOctagonIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import {
  type FullAgentDto,
  type Tool,
  useAgent,
  useAgentAccess,
  useAgents,
  useMcpServers,
  useSkills,
  useTools,
} from "@/lib/queries";
import { AgentAvatar } from "@/components/AgentAvatar";
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

import { ModelPicker, type ModelSelection } from "@/components/ModelPicker";
import { DeleteAgentTriggerButton } from "@/components/DeleteAgentDialog";

type EditState = {
  displayName: string;
  description: string;
  category: string;
  starterPrompts: string[];
  systemPrompt: string;
  modelProvider: string;
  modelId: string;
  reasoningLevel: ReasoningLevel;
  emailEnabled: boolean;
  webEnabled: boolean;
  profileAccessEnabled: boolean;
  accessMode: "everyone" | "specific";
  accessUserIds: string[];
  inboundLocalPart: string;
  toolBindings: Array<{ toolId: string; configJson: Record<string, unknown> }>;
  skillBindings: Array<{ skillId: string; skillVersionId: string }>;
  mcpServerIds: string[];
  subagentIds: string[];
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
    category: a.category ?? "",
    starterPrompts: a.starterPrompts.length > 0 ? [...a.starterPrompts] : [""],
    systemPrompt: a.systemPrompt,
    modelProvider: a.modelProvider,
    modelId: a.modelId,
    reasoningLevel: a.reasoningLevel,
    emailEnabled: a.emailEnabled,
    webEnabled: a.webEnabled,
    profileAccessEnabled: a.profileAccessEnabled,
    accessMode: a.accessMode,
    accessUserIds: a.accessUserIds,
    inboundLocalPart: a.inboundLocalPart,
    toolBindings: a.toolBindings.map((b) => ({
      toolId: b.toolId,
      configJson: b.configJson,
    })),
    skillBindings:
      a.skillBindings ??
      a.skills.map((s) => ({ skillId: s.id, skillVersionId: s.versionId })),
    mcpServerIds: a.mcpServerIds ?? a.mcpServers.map((m) => m.id),
    subagentIds: a.subagentIds ?? a.subagents.map((s) => s.id),
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

type ToolConfigField = {
  key: string;
  title: string;
  description?: string;
  required: boolean;
};

function stringConfigFields(tool: Tool): ToolConfigField[] {
  const schema = tool.configSchema as {
    properties?: Record<
      string,
      { type?: unknown; title?: unknown; description?: unknown }
    >;
    required?: unknown;
  };
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );
  return Object.entries(schema.properties ?? {})
    .filter(([, property]) => property.type === "string")
    .map(([key, property]) => ({
      key,
      title: typeof property.title === "string" ? property.title : key,
      description:
        typeof property.description === "string" ? property.description : undefined,
      required: required.has(key),
    }));
}

export default function AgentEditPage() {
  const { slug } = useParams<{ slug: string }>();
  const agent = useAgent(slug);
  const tools = useTools();
  const skills = useSkills();
  const mcpServers = useMcpServers();
  const allAgents = useAgents();
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
          category: s.category || null,
          starterPrompts: s.starterPrompts.map((p) => p.trim()).filter(Boolean),
          systemPrompt: s.systemPrompt,
          modelProvider: s.modelProvider,
          modelId: s.modelId,
          reasoningLevel: s.reasoningLevel,
          emailEnabled: s.emailEnabled,
          webEnabled: s.webEnabled,
          profileAccessEnabled: s.profileAccessEnabled,
          accessMode: s.accessMode,
          accessUserIds: s.accessUserIds,
          inboundLocalPart: s.inboundLocalPart,
          toolBindings: s.toolBindings,
          skillBindings: s.skillBindings,
          mcpServerIds: s.mcpServerIds,
          subagentIds: s.subagentIds,
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
  const subagentOptions = (allAgents.data ?? []).filter((a) => a.id !== agent.data.id);
  const unpublishedSubagents = (agent.data.subagents ?? []).filter(
    (s) => state.subagentIds.includes(s.id) && !s.hasPublishedVersion,
  );

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
                <AgentAvatar
                  avatar={agent.data.avatar}
                  displayName={agent.data.displayName}
                  size="lg"
                />
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
                <FieldLabel htmlFor="category">Category</FieldLabel>
                <Input
                  id="category"
                  value={state.category}
                  onChange={(e) => setS({ category: e.target.value })}
                  placeholder="Support"
                />
                <FieldDescription>
                  Optional group label shown in the agents list.
                </FieldDescription>
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
              <FieldLabel>Chat starter prompts</FieldLabel>
              <FieldDescription>
                Short suggestions shown when a user opens web chat with no messages. Leave
                all rows empty to use the deployment defaults. Up to 8 prompts, 200
                characters each.
              </FieldDescription>
              <div className="mt-2 flex flex-col gap-2">
                {state.starterPrompts.map((prompt, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={prompt}
                      placeholder="e.g. Summarize my open issues"
                      maxLength={200}
                      onChange={(e) => {
                        const next = [...state.starterPrompts];
                        next[index] = e.target.value;
                        setS({ starterPrompts: next });
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove starter prompt"
                      disabled={state.starterPrompts.length <= 1}
                      onClick={() => {
                        const next = state.starterPrompts.filter((_, i) => i !== index);
                        setS({ starterPrompts: next.length > 0 ? next : [""] });
                      }}
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={state.starterPrompts.length >= 8}
                  onClick={() => setS({ starterPrompts: [...state.starterPrompts, ""] })}
                >
                  <PlusIcon data-icon="inline-start" />
                  Add prompt
                </Button>
              </div>
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
              <Field orientation="horizontal">
                <Switch
                  id="profile-access-enabled"
                  checked={state.profileAccessEnabled}
                  onCheckedChange={(v) => setS({ profileAccessEnabled: v })}
                />
                <FieldContent>
                  <FieldLabel htmlFor="profile-access-enabled">
                    Share request author's profile
                  </FieldLabel>
                  <FieldDescription>
                    When enabled, this agent receives the author profile for each request,
                    including workflow steps where this agent is not first. Publish a new
                    version to apply this setting to live runs.
                  </FieldDescription>
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
          <ModelPicker
            value={{
              modelProvider: state.modelProvider,
              modelId: state.modelId,
              reasoningLevel: state.reasoningLevel,
            }}
            onChange={(model: ModelSelection) =>
              setS({
                modelProvider: model.modelProvider,
                modelId: model.modelId,
                reasoningLevel: model.reasoningLevel,
              })
            }
          />
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
            <>
              <CheckboxGrid
                items={(tools.data ?? [])
                  .filter(
                    (t) =>
                      !t.deprecated ||
                      state.toolBindings.some((binding) => binding.toolId === t.id),
                  )
                  .map((t) => ({
                    id: t.id,
                    title: t.name,
                    description: t.description,
                  }))}
                selected={state.toolBindings.map((binding) => binding.toolId)}
                onToggle={(id, on) => {
                  setS({
                    toolBindings: on
                      ? [...state.toolBindings, { toolId: id, configJson: {} }]
                      : state.toolBindings.filter((binding) => binding.toolId !== id),
                  });
                }}
              />

              {state.toolBindings.map((binding) => {
                const tool = tools.data.find(
                  (candidate) => candidate.id === binding.toolId,
                );
                if (!tool) return null;
                const fields = stringConfigFields(tool);
                if (fields.length === 0) return null;
                return (
                  <FieldSet key={binding.toolId} className="rounded-lg border p-4">
                    <FieldLegend>{tool.name} configuration</FieldLegend>
                    <FieldDescription>
                      These values are frozen into the next published agent version.
                      {tool.requiresSecrets
                        ? " Its credential is managed separately under Service secrets."
                        : ""}
                    </FieldDescription>
                    <FieldGroup>
                      {fields.map((field) => {
                        const inputId = `tool-${tool.key}-${field.key}`;
                        const value = binding.configJson[field.key];
                        return (
                          <Field key={field.key}>
                            <FieldLabel htmlFor={inputId}>
                              {field.title}
                              {field.required ? " *" : ""}
                            </FieldLabel>
                            <Input
                              id={inputId}
                              required={field.required}
                              value={typeof value === "string" ? value : ""}
                              onChange={(event) =>
                                setS({
                                  toolBindings: state.toolBindings.map((candidate) =>
                                    candidate.toolId === binding.toolId
                                      ? {
                                          ...candidate,
                                          configJson: {
                                            ...candidate.configJson,
                                            [field.key]: event.target.value,
                                          },
                                        }
                                      : candidate,
                                  ),
                                })
                              }
                            />
                            {field.description ? (
                              <FieldDescription>{field.description}</FieldDescription>
                            ) : null}
                          </Field>
                        );
                      })}
                    </FieldGroup>
                  </FieldSet>
                );
              })}
            </>
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
            <PlugsConnectedIcon className="size-4" weight="duotone" />
            MCP servers
          </CardTitle>
          <CardDescription>
            Attach servers from the{" "}
            <Link
              to="/library/mcp"
              className="text-primary underline-offset-4 hover:underline"
            >
              MCP library
            </Link>
            . Credentials are managed centrally; publish after changing attachments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mcpServers.data?.length ? (
            <CheckboxGrid
              items={mcpServers.data.map((m) => ({
                id: m.id,
                title: m.label,
                description: `${m.name} · ${m.serverUrl}`,
              }))}
              selected={state.mcpServerIds}
              onToggle={(id, on) => {
                const next = new Set(state.mcpServerIds);
                if (on) next.add(id);
                else next.delete(id);
                setS({ mcpServerIds: [...next] });
              }}
            />
          ) : (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PlugsConnectedIcon />
                </EmptyMedia>
                <EmptyTitle>No MCP servers in the library</EmptyTitle>
                <EmptyDescription>
                  <Link
                    to="/library/mcp"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Add an MCP server
                  </Link>{" "}
                  before attaching it here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersThreeIcon className="size-4" weight="duotone" />
            Subagents
          </CardTitle>
          <CardDescription>
            Other agents this agent can delegate to with the <code>run_subagent</code>{" "}
            tool. Each delegation runs the selected agent in a fresh, isolated workspace
            and returns its final answer. The callee&apos;s published version is pinned
            when you publish this agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {unpublishedSubagents.length > 0 ? (
            <div className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <WarningIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div>
                These selected subagents have no published version and will block
                publishing until you publish them:{" "}
                <span className="font-medium">
                  {unpublishedSubagents.map((s) => s.displayName).join(", ")}
                </span>
                .
              </div>
            </div>
          ) : null}
          {subagentOptions.length > 0 ? (
            <CheckboxGrid
              items={subagentOptions.map((a) => ({
                id: a.id,
                title: a.displayName,
                description: a.description ?? a.slug,
              }))}
              selected={state.subagentIds}
              onToggle={(id, on) => {
                const next = new Set(state.subagentIds);
                if (on) next.add(id);
                else next.delete(id);
                setS({ subagentIds: [...next] });
              }}
            />
          ) : (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersThreeIcon />
                </EmptyMedia>
                <EmptyTitle>No other agents</EmptyTitle>
                <EmptyDescription>
                  Create another agent to delegate work to it from here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <TrashIcon className="size-4" weight="duotone" />
            Danger zone
          </CardTitle>
          <CardDescription>
            Permanently remove this agent and all of its conversations, runs, sandboxes,
            and memory documents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAgentTriggerButton slug={slug!} displayName={agent.data.displayName} />
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
