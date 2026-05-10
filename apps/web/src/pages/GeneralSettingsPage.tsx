import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EraserIcon, FloppyDiskIcon, ImageIcon } from "@phosphor-icons/react";
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
    title: "Email footer logo URL",
    description:
      "Logo image rendered at the bottom of every outbound agent email. Accepts an absolute https:// URL, or /static/<file> to reference an image dropped into apps/api/src/emails/static/. Leave empty to hide the footer image.",
  },
};

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
                        className="flex flex-col gap-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setSetting.mutate({ key: s.key, value: draft });
                        }}
                      >
                        <Field>
                          <FieldLabel htmlFor={`setting-${s.key}`}>Value</FieldLabel>
                          <Input
                            id={`setting-${s.key}`}
                            value={draft}
                            placeholder={
                              s.key === "email_footer_logo_url"
                                ? "https://example.com/logo.png or /static/logo.png"
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
