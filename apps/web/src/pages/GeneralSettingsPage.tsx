import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CloudArrowUpIcon,
  EraserIcon,
  FloppyDiskIcon,
  ImageIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { assetSrc, useAppSettings } from "@/lib/queries";
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
  product_name: {
    title: "Product name",
    description:
      "Name shown in the browser title, sign-in/setup screens, and sidebar header. Leave empty to use open-agents.",
  },
  favicon_url: {
    title: "Favicon",
    description:
      "Browser tab icon for this deployment. Upload a file to host it locally, or paste an absolute https:// URL.",
  },
  sidebar_logo_url: {
    title: "Sidebar logo",
    description:
      "Image shown in the sidebar brand mark. Upload a square or compact transparent image for best results.",
  },
  email_footer_logo_url: {
    title: "Email footer logo",
    description:
      "Logo image rendered at the bottom of every outbound agent email. Upload a file to host it locally, or paste an absolute https:// URL to use one you already host. Leave empty to hide the footer image.",
  },
};

const IMAGE_SETTING_KEYS = new Set([
  "favicon_url",
  "sidebar_logo_url",
  "email_footer_logo_url",
]);

export default function GeneralSettingsPage() {
  const settings = useAppSettings();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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
      await qc.invalidateQueries({ queryKey: ["settings", "public"] });
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
      await qc.invalidateQueries({ queryKey: ["settings", "public"] });
    },
    onError: (e) =>
      toast.error("Couldn't clear", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const uploadImage = useMutation({
    mutationFn: async ({ key, file }: { key: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/settings/${key}/image`, {
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
    onSuccess: async (resp, { key }) => {
      setDrafts((d) => ({ ...d, [key]: resp.value }));
      toast.success("Image uploaded", {
        description: LABELS[key]?.title ?? key,
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["settings", "public"] });
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
              const isImage = IMAGE_SETTING_KEYS.has(s.key);
              const preview = isImage ? assetSrc(persisted) : undefined;
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
                        {isImage ? (
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
                              id={`setting-upload-${s.key}`}
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) uploadImage.mutate({ key: s.key, file });
                                e.target.value = "";
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={uploadImage.isPending}
                              onClick={() =>
                                document
                                  .getElementById(`setting-upload-${s.key}`)
                                  ?.click()
                              }
                            >
                              {uploadImage.isPending ? (
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
                            {isImage ? "URL" : "Value"}
                          </FieldLabel>
                          <Input
                            id={`setting-${s.key}`}
                            value={draft}
                            placeholder={
                              isImage
                                ? "https://example.com/logo.png or /static/uploads/<folder>/<file>"
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
