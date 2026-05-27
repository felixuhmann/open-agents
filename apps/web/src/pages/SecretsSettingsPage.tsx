import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircleIcon,
  EraserIcon,
  FloppyDiskIcon,
  KeyIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { useSecrets } from "@/lib/queries";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

const LABELS: Record<string, string> = {
  anthropic_api_key: "Anthropic API key",
  daytona_api_key: "Daytona API key",
  mailgun_api_key: "Mailgun API key",
  mailgun_domain: "Mailgun domain (e.g. mg.example.com)",
  mailgun_signing_key: "Mailgun signing key (HTTP webhook signing)",
};

export default function SecretsSettingsPage() {
  const secrets = useSecrets();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const setSecret = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api(`/api/secrets/${key}`, {
        method: "PUT",
        json: { value },
      }),
    onSuccess: async (_d, { key }) => {
      setDrafts((d) => ({ ...d, [key]: "" }));
      toast.success("Secret saved", {
        description: LABELS[key] ?? key,
      });
      await qc.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (e) =>
      toast.error("Save failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const clearSecret = useMutation({
    mutationFn: (key: string) => api(`/api/secrets/${key}`, { method: "DELETE" }),
    onSuccess: async (_d, key) => {
      toast.success("Secret cleared", {
        description: LABELS[key] ?? key,
      });
      await qc.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (e) =>
      toast.error("Couldn't clear", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Service secrets"
        description="Model, sandbox, and Mailgun credentials. Stored AES-GCM encrypted in the database. Saved values are never returned by the API."
      />

      <ul className="flex flex-col gap-3">
        {secrets.isLoading
          ? Array.from({ length: 5 }).map((_, idx) => (
              <li key={idx}>
                <Skeleton className="h-32 w-full" />
              </li>
            ))
          : secrets.data?.map((s) => (
              <li key={s.key}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <KeyIcon className="size-4" weight="duotone" />
                      {LABELS[s.key] ?? s.key}
                    </CardTitle>
                    <CardDescription className="font-mono">{s.key}</CardDescription>
                    <CardAction>
                      {s.configured ? (
                        <Badge>
                          <CheckCircleIcon data-icon="inline-start" />
                          configured
                        </Badge>
                      ) : (
                        <Badge variant="outline">not set</Badge>
                      )}
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="flex flex-col gap-2 sm:flex-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = drafts[s.key] ?? "";
                        if (!value) return;
                        setSecret.mutate({ key: s.key, value });
                      }}
                    >
                      <Input
                        type="password"
                        className="flex-1"
                        placeholder={
                          s.configured ? "Rotate to a new value…" : "Enter value…"
                        }
                        value={drafts[s.key] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [s.key]: e.target.value }))
                        }
                      />
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          disabled={setSecret.isPending || !(drafts[s.key] ?? "")}
                        >
                          {setSecret.isPending ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <FloppyDiskIcon data-icon="inline-start" />
                          )}
                          Save
                        </Button>
                        {s.configured ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button type="button" variant="destructive">
                                <EraserIcon data-icon="inline-start" />
                                Clear
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Clear {LABELS[s.key] ?? s.key}?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Removes the stored value immediately. Any service that
                                  needs it will start failing until you set a new value.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => clearSecret.mutate(s.key)}
                                >
                                  Clear secret
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : null}
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </li>
            ))}
      </ul>
    </div>
  );
}
