import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TrashIcon } from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
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
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type DeleteAgentDialogProps = {
  slug: string;
  displayName: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  redirectTo?: string;
};

export function DeleteAgentDialog({
  slug,
  displayName,
  open: controlledOpen,
  onOpenChange,
  trigger,
  redirectTo = "/agents",
}: DeleteAgentDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setInternalOpen(next);
  };

  useEffect(() => {
    if (!open) setConfirmSlug("");
  }, [open]);

  const remove = useMutation({
    mutationFn: () => api(`/api/agents/${slug}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Agent deleted", {
        description: `${displayName} and its history have been removed.`,
      });
      await qc.invalidateQueries({ queryKey: ["agents"] });
      setOpen(false);
      void navigate(redirectTo);
    },
    onError: (e) =>
      toast.error("Couldn't delete agent", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const canConfirm = confirmSlug === slug;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the agent, its published versions, chat
            conversations, email threads, runs, sandboxes, and memory documents. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor={`delete-agent-${slug}`}>
            Type <span className="font-mono">{slug}</span> to confirm
          </FieldLabel>
          <Input
            id={`delete-agent-${slug}`}
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
            placeholder={slug}
            className="font-mono"
            autoComplete="off"
          />
          <FieldDescription>
            The slug is required so you don&apos;t delete the wrong agent.
          </FieldDescription>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm || remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              remove.mutate();
            }}
          >
            {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
            {remove.isPending ? "Deleting…" : "Delete agent"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteAgentTriggerButton({
  size = "default",
  variant = "destructive",
  ...dialogProps
}: Omit<DeleteAgentDialogProps, "trigger"> & {
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <DeleteAgentDialog
      {...dialogProps}
      trigger={
        <Button type="button" variant={variant} size={size}>
          <TrashIcon data-icon="inline-start" />
          Delete agent
        </Button>
      }
    />
  );
}
