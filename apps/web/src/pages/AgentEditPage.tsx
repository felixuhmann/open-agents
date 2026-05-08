import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  BrainIcon,
  CloudArrowUpIcon,
  FloppyDiskIcon,
  IdentificationCardIcon,
  PlusIcon,
  PuzzlePieceIcon,
  TrashIcon,
  WarningOctagonIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { type FullAgentDto, useAgent, useSkills, useTools } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
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
  inboundLocalPart: string;
  toolIds: string[];
  skillIds: string[];
  thirdPartyMcp: Array<{ id?: string; label: string; serverUrl: string }>;
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
    inboundLocalPart: a.inboundLocalPart,
    toolIds: a.toolBindings.map((b) => b.toolId),
    skillIds: a.skillIds,
    thirdPartyMcp: a.thirdPartyMcp.map((m) => ({
      id: m.id,
      label: m.label,
      serverUrl: m.serverUrl,
    })),
  };
}

export default function AgentEditPage() {
  const { slug } = useParams<{ slug: string }>();
  const agent = useAgent(slug);
  const tools = useTools();
  const skills = useSkills();
  const qc = useQueryClient();
  const [state, setState] = useState<EditState | null>(null);

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
          inboundLocalPart: s.inboundLocalPart,
          toolBindings: s.toolIds.map((id) => ({ toolId: id })),
          skillIds: s.skillIds,
          thirdPartyMcp: s.thirdPartyMcp,
        },
      }),
    onSuccess: async () => {
      toast.success("Agent saved");
      await qc.invalidateQueries({ queryKey: ["agents", slug] });
    },
    onError: (e) =>
      toast.error("Save failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      api<FullAgentDto>(`/api/agents/${slug}/publish`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Published to Anthropic", {
        description: "The new version is now live.",
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
              {publishMutation.isPending ? "Publishing…" : "Publish to Anthropic"}
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
                <FieldLabel htmlFor="local-part">Inbound email local part</FieldLabel>
                <Input
                  id="local-part"
                  className="font-mono"
                  value={state.inboundLocalPart}
                  onChange={(e) => setS({ inboundLocalPart: e.target.value })}
                />
                <FieldDescription>
                  The bit before <code>@</code> in your Mailgun catch-all domain.
                </FieldDescription>
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
                  <FieldDescription>
                    Receives mail at the inbound local part above.
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
            Which Anthropic model powers the agent. Re-publish to apply.
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
            Tools
          </CardTitle>
          <CardDescription>
            Capabilities the agent can call. Managed-runtime tools execute in
            Anthropic&apos;s container; platform tools run on this backend via{" "}
            <code>/mcp/{state.inboundLocalPart || slug}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {tools.data?.length ? (
            (["managed", "platform"] as const).map((runtime) => {
              const groupItems = (tools.data ?? []).filter(
                (t) =>
                  t.runtime === runtime &&
                  (!t.deprecated || state.toolIds.includes(t.id)),
              );
              if (groupItems.length === 0) return null;
              return (
                <FieldSet key={runtime}>
                  <FieldLegend variant="label">
                    {runtime === "managed"
                      ? "Managed by Anthropic"
                      : "Platform (this backend)"}
                  </FieldLegend>
                  <CheckboxGrid
                    items={groupItems.map((t) => ({
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
                </FieldSet>
              );
            })
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
            <CheckboxGrid
              items={skills.data.map((s) => ({
                id: s.id,
                title: s.name,
                description: s.description ?? undefined,
              }))}
              selected={state.skillIds}
              onToggle={(id, on) => {
                const next = new Set(state.skillIds);
                if (on) next.add(id);
                else next.delete(id);
                setS({ skillIds: [...next] });
              }}
            />
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
            <CloudArrowUpIcon className="size-4" weight="duotone" />
            Third-party MCP servers
          </CardTitle>
          <CardDescription>
            Remote MCP servers exposed to the agent. The Anthropic sandbox connects on
            each run.
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
                {checked ? <Badge variant="secondary">on</Badge> : null}
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
