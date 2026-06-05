import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChatCircleDotsIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { useAgents, useWorkflow, useWorkflowAccess } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type StepRow = { agentId: string };

export default function WorkflowEditPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const workflow = useWorkflow(slug);
  const agents = useAgents();
  const access = useWorkflowAccess(slug);

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [starterPrompts, setStarterPrompts] = useState<string[]>([""]);
  const [webEnabled, setWebEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [inboundLocalPart, setInboundLocalPart] = useState("");
  const [accessMode, setAccessMode] = useState<"everyone" | "specific">("everyone");
  const [accessUserIds, setAccessUserIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [pickAgent, setPickAgent] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!workflow.data || hydrated) return;
    setDisplayName(workflow.data.displayName);
    setDescription(workflow.data.description ?? "");
    setStarterPrompts(
      workflow.data.starterPrompts.length > 0 ? [...workflow.data.starterPrompts] : [""],
    );
    setWebEnabled(workflow.data.webEnabled);
    setEmailEnabled(workflow.data.emailEnabled);
    setInboundLocalPart(workflow.data.inboundLocalPart);
    setAccessMode(workflow.data.accessMode);
    setAccessUserIds(workflow.data.accessUserIds);
    setSteps(workflow.data.steps.map((s) => ({ agentId: s.agentId })));
    setHydrated(true);
  }, [workflow.data, hydrated]);

  // Published / display info per agent id (from saved steps + agent catalog).
  const agentInfo = useMemo(() => {
    const map = new Map<
      string,
      { displayName: string; slug: string; published: boolean | null }
    >();
    for (const a of agents.data ?? []) {
      map.set(a.id, { displayName: a.displayName, slug: a.slug, published: null });
    }
    for (const s of workflow.data?.steps ?? []) {
      map.set(s.agentId, {
        displayName: s.agentDisplayName,
        slug: s.agentSlug,
        published: s.agentPublished,
      });
    }
    return map;
  }, [agents.data, workflow.data]);

  const patchPayload = () => ({
    displayName,
    description: description.trim() ? description.trim() : null,
    starterPrompts: starterPrompts.map((p) => p.trim()).filter(Boolean),
    webEnabled,
    emailEnabled,
    inboundLocalPart,
    accessMode,
    accessUserIds: accessMode === "specific" ? accessUserIds : [],
    steps: steps.map((s) => ({ agentId: s.agentId })),
  });

  const save = useMutation({
    mutationFn: () =>
      api(`/api/workflows/${slug}`, {
        method: "PATCH",
        json: patchPayload(),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["workflows"] });
      await qc.invalidateQueries({ queryKey: ["workflows", slug] });
      toast.success("Draft saved");
    },
    onError: (e) =>
      toast.error("Couldn't save", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const publish = useMutation({
    mutationFn: async () => {
      // Persist the current draft first, then freeze a version.
      await api(`/api/workflows/${slug}`, {
        method: "PATCH",
        json: patchPayload(),
      });
      return api(`/api/workflows/${slug}/publish`, { method: "POST" });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["workflows"] });
      await qc.invalidateQueries({ queryKey: ["workflows", slug] });
      toast.success("Workflow published", {
        description: "New conversations use the latest pipeline.",
      });
    },
    onError: (e) =>
      toast.error("Couldn't publish", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  if (!workflow.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[index]!;
      const b = next[target]!;
      next[index] = b;
      next[target] = a;
      return next;
    });
  };

  const removeStep = (index: number) =>
    setSteps((prev) => prev.filter((_, i) => i !== index));

  const addStep = () => {
    if (!pickAgent) return;
    setSteps((prev) => [...prev, { agentId: pickAgent }]);
    setPickAgent("");
  };

  const busy = save.isPending || publish.isPending;
  const emailAddress = `${inboundLocalPart || slug || "slug"}@${
    workflow.data.mailgunDomain ?? "your email domain"
  }`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Edit ${workflow.data.displayName}`}
        meta={workflow.data.slug}
        description="Add published agents as ordered steps. Publish to freeze the pipeline for new conversations."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/workflows/${slug}/chat`}>
                <ChatCircleDotsIcon data-icon="inline-start" />
                Open chat
              </Link>
            </Button>
            <Button variant="outline" onClick={() => save.mutate()} disabled={busy}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save draft
            </Button>
            <Button onClick={() => publish.mutate()} disabled={busy}>
              {publish.isPending ? <Spinner data-icon="inline-start" /> : null}
              Publish
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="wf-name">Display name</FieldLabel>
              <Input
                id="wf-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="wf-desc">Description</FieldLabel>
              <Textarea
                id="wf-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Chat starter prompts</FieldLabel>
              <FieldDescription>
                Suggestions shown in the workflow chat empty state. Leave all rows empty
                to use deployment defaults. Up to 8 prompts, 200 characters each.
              </FieldDescription>
              <div className="mt-2 flex flex-col gap-2">
                {starterPrompts.map((prompt, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={prompt}
                      placeholder="e.g. Run the onboarding pipeline"
                      maxLength={200}
                      onChange={(e) => {
                        const next = [...starterPrompts];
                        next[index] = e.target.value;
                        setStarterPrompts(next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove starter prompt"
                      disabled={starterPrompts.length <= 1}
                      onClick={() => {
                        const next = starterPrompts.filter((_, i) => i !== index);
                        setStarterPrompts(next.length > 0 ? next : [""]);
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
                  disabled={starterPrompts.length >= 8}
                  onClick={() => setStarterPrompts([...starterPrompts, ""])}
                >
                  <PlusIcon data-icon="inline-start" />
                  Add prompt
                </Button>
              </div>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Surfaces</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <FieldLabel>Web chat</FieldLabel>
              <FieldDescription>
                Exposes <code>/workflows/{slug}/chat</code>
              </FieldDescription>
            </div>
            <Switch checked={webEnabled} onCheckedChange={setWebEnabled} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <FieldLabel>Email</FieldLabel>
              <FieldDescription>
                Inbound mail at <span className="font-mono text-xs">{emailAddress}</span>
              </FieldDescription>
            </div>
            <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
          </div>
          {emailEnabled ? (
            <Field>
              <FieldLabel htmlFor="wf-local-part">Email slug</FieldLabel>
              <Input
                id="wf-local-part"
                className="font-mono"
                value={inboundLocalPart}
                onChange={(e) => setInboundLocalPart(e.target.value)}
              />
              <FieldDescription>{emailAddress}</FieldDescription>
            </Field>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline steps</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No steps yet. Add at least one agent below.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {steps.map((step, index) => {
                const info = agentInfo.get(step.agentId);
                const unpublished = info?.published === false;
                return (
                  <li
                    key={`${step.agentId}-${index}`}
                    className="flex items-center gap-3 border bg-card px-3 py-2"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {info?.displayName ?? step.agentId}
                        </span>
                        {unpublished ? (
                          <Badge
                            variant="outline"
                            className="gap-1 text-amber-600 dark:text-amber-500"
                          >
                            <WarningCircleIcon className="size-3" />
                            unpublished
                          </Badge>
                        ) : null}
                      </div>
                      {info?.slug ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {info.slug}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Move down"
                        disabled={index === steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove step"
                        onClick={() => removeStep(index)}
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Select value={pickAgent} onValueChange={setPickAgent}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an agent to add…" />
                </SelectTrigger>
                <SelectContent>
                  {(agents.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addStep}
              disabled={!pickAgent}
            >
              <PlusIcon data-icon="inline-start" />
              Add step
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="wf-access">Who can use this workflow</FieldLabel>
            <Select
              value={accessMode}
              onValueChange={(v) => setAccessMode(v as "everyone" | "specific")}
            >
              <SelectTrigger id="wf-access" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="everyone">Everyone in the workspace</SelectItem>
                <SelectItem value="specific">Specific members</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              Operators (admins / contributors) always have access.
            </FieldDescription>
          </Field>

          {accessMode === "specific" ? (
            <div className="flex flex-col gap-2">
              {(access.data?.users ?? []).map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={accessUserIds.includes(u.id)}
                    onCheckedChange={(checked) =>
                      setAccessUserIds((prev) =>
                        checked
                          ? [...new Set([...prev, u.id])]
                          : prev.filter((id) => id !== u.id),
                      )
                    }
                  />
                  <span>{u.email}</span>
                  <Badge variant="outline" className="capitalize">
                    {u.role}
                  </Badge>
                </label>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate("/workflows")}>
          Back to workflows
        </Button>
      </div>
    </div>
  );
}
