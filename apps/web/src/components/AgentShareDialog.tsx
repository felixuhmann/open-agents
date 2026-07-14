import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, ShareNetworkIcon, TrashIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  slug: string;
  enabled: boolean;
};

export function AgentShareDialog({ slug, enabled }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = useMemo(() => {
    if (!shareToken) return null;
    const url = new URL(`/agents/${slug}/chat`, window.location.origin);
    url.searchParams.set("share", shareToken);
    return url.toString();
  }, [shareToken, slug]);

  const enableShare = useMutation({
    mutationFn: () =>
      api<{ enabled: true; shareToken: string }>(`/api/agents/${slug}/share`, {
        method: "POST",
      }),
    onSuccess: async (result) => {
      setShareToken(result.shareToken);
      await queryClient.invalidateQueries({ queryKey: ["agents", slug] });
    },
    onError: (error) => {
      toast.error("Couldn’t enable sharing", {
        description: error instanceof ApiError ? error.message : String(error),
      });
    },
  });

  const disableShare = useMutation({
    mutationFn: () =>
      api<{ enabled: false }>(`/api/agents/${slug}/share`, { method: "DELETE" }),
    onSuccess: async () => {
      setShareToken(null);
      setOpen(false);
      toast.success("Public sharing disabled");
      await queryClient.invalidateQueries({ queryKey: ["agents", slug] });
    },
    onError: (error) => {
      toast.error("Couldn’t disable sharing", {
        description: error instanceof ApiError ? error.message : String(error),
      });
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && !shareToken && !enableShare.isPending) {
      enableShare.mutate();
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Share link copied");
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ShareNetworkIcon data-icon="inline-start" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {slug}</DialogTitle>
          <DialogDescription>
            Anyone with this link can start a private chat without signing in. They cannot
            access the agent panel or other visitors’ conversations.
          </DialogDescription>
        </DialogHeader>

        {enableShare.isPending ? (
          <div className="flex min-h-24 items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : shareUrl ? (
          <code className="block max-h-28 overflow-auto border border-border bg-muted p-3 text-xs break-all">
            {shareUrl}
          </code>
        ) : (
          <p className="py-6 text-sm text-muted-foreground">
            The share link could not be generated.
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          {enabled || shareToken ? (
            <Button
              type="button"
              variant="destructive"
              disabled={disableShare.isPending}
              onClick={() => disableShare.mutate()}
            >
              {disableShare.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <TrashIcon data-icon="inline-start" />
              )}
              Disable sharing
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" disabled={!shareUrl} onClick={() => void copyLink()}>
            {copied ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <CopyIcon data-icon="inline-start" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
