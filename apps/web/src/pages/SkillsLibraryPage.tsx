import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudArrowUpIcon, PuzzlePieceIcon, TrashIcon } from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { useSkills } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export default function SkillsLibraryPage() {
  const skills = useSkills();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !name) throw new Error("name and file required");
      const fd = new FormData();
      fd.append("name", name);
      if (description) fd.append("description", description);
      fd.append("file", file);
      const r = await fetch("/api/skills", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(r.status, body.error ?? r.statusText);
      }
      return (await r.json()) as { id: string };
    },
    onSuccess: async () => {
      setName("");
      setDescription("");
      setFile(null);
      toast.success("Skill uploaded");
      await qc.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (e) =>
      toast.error("Upload failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/skills/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Skill removed");
      await qc.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (e) =>
      toast.error("Couldn't delete", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Skills"
        description={
          <>
            Upload skill bundles (zip with <code>SKILL.md</code> at the root). Available
            to all agents in this deployment.
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudArrowUpIcon className="size-4" weight="duotone" />
            Upload bundle
          </CardTitle>
          <CardDescription>
            Provide a name, optional description, and the .zip archive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="upload-skill"
            onSubmit={(e) => {
              e.preventDefault();
              upload.mutate();
            }}
          >
            <FieldGroup>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="skill-name">Name</FieldLabel>
                  <Input
                    id="skill-name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="customer-support"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="skill-file">Bundle (.zip)</FieldLabel>
                  <Input
                    id="skill-file"
                    type="file"
                    accept=".zip,application/zip"
                    required
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <FieldDescription>
                    Must contain <code>SKILL.md</code> at the root.
                  </FieldDescription>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="skill-desc">
                  Description
                  <span className="text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Textarea
                  id="skill-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Button
                form="upload-skill"
                type="submit"
                disabled={upload.isPending}
                className="w-fit"
              >
                {upload.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CloudArrowUpIcon data-icon="inline-start" />
                )}
                {upload.isPending ? "Uploading…" : "Upload"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {skills.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, idx) => (
            <Skeleton key={idx} className="h-32" />
          ))}
        </div>
      ) : !skills.data || skills.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PuzzlePieceIcon />
            </EmptyMedia>
            <EmptyTitle>No skills uploaded</EmptyTitle>
            <EmptyDescription>
              Upload your first bundle above to make it available to agents.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {skills.data.map((s) => (
            <li key={s.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PuzzlePieceIcon className="size-4" weight="duotone" />
                    {s.name}
                  </CardTitle>
                  <CardDescription>
                    {s.anthropicSkillId ? (
                      <span className="font-mono">{s.anthropicSkillId}</span>
                    ) : (
                      <Badge variant="outline">local only</Badge>
                    )}
                  </CardDescription>
                  <CardAction>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => remove.mutate(s.id)}
                      disabled={remove.isPending}
                      aria-label={`Delete ${s.name}`}
                    >
                      <TrashIcon />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <p className="text-xs/relaxed text-foreground">
                    {s.description ?? (
                      <span className="text-muted-foreground italic">
                        No description.
                      </span>
                    )}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
