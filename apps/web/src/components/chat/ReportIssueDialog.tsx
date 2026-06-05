import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { WarningCircleIcon } from "@phosphor-icons/react";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Props =
  | {
      conversationId: string;
      workflowConversationId?: never;
      targetLabel?: string;
    }
  | {
      conversationId?: never;
      workflowConversationId: string;
      targetLabel?: string;
    };

export function ReportIssueDialog({
  conversationId,
  workflowConversationId,
  targetLabel = "conversation",
}: Props) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/issues", {
        json: {
          ...(conversationId ? { conversationId } : { workflowConversationId }),
          description: description.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Report filed", {
        description: "An admin will review the conversation.",
      });
      setOpen(false);
      setDescription("");
    },
    onError: (e) =>
      toast.error("Couldn't file report", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <WarningCircleIcon data-icon="inline-start" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report this {targetLabel}</DialogTitle>
          <DialogDescription>
            Describe what went wrong and what you expected instead. The full conversation
            history will be shared with admins so they can investigate.
          </DialogDescription>
        </DialogHeader>
        <form
          id="report-issue-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!description.trim()) return;
            submit.mutate();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="issue-description">What went wrong?</FieldLabel>
              <Textarea
                id="issue-description"
                rows={5}
                required
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="The agent claimed it updated the spreadsheet, but the file was unchanged."
              />
              <FieldDescription>
                {description.trim().length} / 4000 characters
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submit.isPending}
          >
            Cancel
          </Button>
          <Button
            form="report-issue-form"
            type="submit"
            disabled={submit.isPending || !description.trim()}
          >
            {submit.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <WarningCircleIcon data-icon="inline-start" />
            )}
            {submit.isPending ? "Submitting..." : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
