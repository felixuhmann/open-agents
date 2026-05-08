import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CloudArrowUpIcon,
  EraserIcon,
  FloppyDiskIcon,
  ImageIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { useAppSettings } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

const LABELS: Record<string, { title: string; description: string }> = {
  email_footer_logo_url: {
    title: "Email footer logo",
    description:
      "Logo image rendered at the bottom of every outbound agent email. Upload a file to host it locally, or paste an absolute https:// URL to use one you already host. Leave empty to hide the footer image.",
  },
};

/**
 * Resolve a stored asset reference (`/static/...` URL path or absolute
 * URL) into something a browser `<img src>` can load. Mirrors the
 * server-side `resolveAssetUrl` minus the `PUBLIC_BASE_URL` prefix —
 * the SPA always fetches uploads from the same origin.
 */
function previewSrc(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/static/")) return trimmed;
  return undefined;
}

export default function GeneralSettingsPage() {
  const settings = useAppSettings();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!settings.data) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of settings.data) {
        if (next[row.key] === undefined) next[row.key] = row.value ?? "";
      }
      return next;
    });
  }, [settings.data]);

  const setSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api(`/api/settings/${key}`, { method: "PUT", json: { value } }),
    onSuccess: async (_d, { key }) => {
      toast.success("Setting saved", {
        description: LABELS[key]?.title ?? key,
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) =>
      toast.error("Save failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const clearSetting = useMutation({
    mutationFn: (key: string) => api(`/api/settings/${key}`, { method: "DELETE" }),
    onSuccess: async (_d, key) => {
      setDrafts((d) => ({ ...d, [key]: "" }));
      toast.success("Setting cleared", {
        description: LABELS[key]?.title ?? key,
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) =>
      toast.error("Couldn't clear", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const uploadFooter = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/settings/email-footer-logo", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(r.status, body.error ?? r.statusText);
      }
      return (await r.json()) as { value: string };
    },
    onSuccess: async (resp) => {
      setDrafts((d) => ({ ...d, email_footer_logo_url: resp.value }));
      toast.success("Footer logo uploaded");
      await qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) =>
      toast.error("Upload failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="General settings"
        description="Deployment-wide configuration values stored in the database. Anything sensitive (API keys, signing secrets) belongs under Settings → Secrets."
      />

      <ul className="flex flex-col gap-3">
        {settings.isLoading
          ? Array.from({ length: 1 }).map((_, idx) => (
              <li key={idx}>
                <Skeleton className="h-32 w-full" />
              </li>
            ))
          : settings.data?.map((s) => {
              const label = LABELS[s.key];
              const draft = drafts[s.key] ?? "";
              const persisted = s.value ?? "";
              const dirty = draft.trim() !== persisted.trim();
              const isFooter = s.key === "email_footer_logo_url";
              const preview = isFooter ? previewSrc(persisted) : undefined;
              return (
                <li key={s.key}>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <ImageIcon className="size-4" weight="duotone" />
                        {label?.title ?? s.key}
                      </CardTitle>
                      <CardDescription className="font-mono">{s.key}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="flex flex-col gap-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setSetting.mutate({ key: s.key, value: draft });
                        }}
                      >
                        {isFooter ? (
                          <div className="flex items-center gap-4">
                            <div className="flex h-16 w-32 items-center justify-center border bg-muted/30">
                              {preview ? (
                                <img
                                  src={preview}
                                  alt=""
                                  className="max-h-full max-w-full object-contain"
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No image
                                </span>
                              )}
                            </div>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) uploadFooter.mutate(file);
                                e.target.value = "";
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={uploadFooter.isPending}
                              onClick={() => fileInputRef.current?.click()}
                            >
                              {uploadFooter.isPending ? (
                                <Spinner data-icon="inline-start" />
                              ) : (
                                <CloudArrowUpIcon data-icon="inline-start" />
                              )}
                              {persisted ? "Replace image" : "Upload image"}
                            </Button>
                          </div>
                        ) : null}
                        <Field>
                          <FieldLabel htmlFor={`setting-${s.key}`}>
                            {isFooter ? "URL" : "Value"}
                          </FieldLabel>
                          <Input
                            id={`setting-${s.key}`}
                            value={draft}
                            placeholder={
                              isFooter
                                ? "https://example.com/logo.png or /static/uploads/footer/<file>"
                                : ""
                            }
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [s.key]: e.target.value }))
                            }
                          />
                          {label?.description ? (
                            <FieldDescription>{label.description}</FieldDescription>
                          ) : null}
                        </Field>
                        <div className="flex gap-2">
                          <Button type="submit" disabled={setSetting.isPending || !dirty}>
                            {setSetting.isPending ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <FloppyDiskIcon data-icon="inline-start" />
                            )}
                            Save
                          </Button>
                          {persisted ? (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={clearSetting.isPending}
                              onClick={() => clearSetting.mutate(s.key)}
                            >
                              {clearSetting.isPending ? (
                                <Spinner data-icon="inline-start" />
                              ) : (
                                <EraserIcon data-icon="inline-start" />
                              )}
                              Clear
                            </Button>
                          ) : null}
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
      </ul>
    </div>
  );
}
