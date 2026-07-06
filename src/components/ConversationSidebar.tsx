import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, MessageSquare, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/hooks/useConversations";
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

interface Props {
  conversations: Conversation[];
  activeId: string | undefined;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose?: () => void;
}

export function ConversationSidebar({ conversations, activeId, onNew, onDelete, onClose }: Props) {
  const navigate = useNavigate();

  const handleDelete = (id: string) => {
    onDelete(id);
    if (id === activeId) navigate("/");
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-card/50 backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Button
          onClick={onNew}
          className="flex-1 justify-start gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          Nouvelle conversation
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Aucune conversation. Crées-en une pour commencer.
          </p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id} className="group flex items-center gap-1">
                <Link
                  to={`/c/${c.id}`}
                  onClick={onClose}
                  className={cn(
                    "flex flex-1 items-center gap-2 truncate rounded-lg px-3 py-2 text-sm transition-colors",
                    activeId === c.id
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-card hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{c.title || "Sans titre"}</span>
                </Link>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 text-muted-foreground hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Supprimer cette conversation ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Tous les messages de cette conversation seront supprimés définitivement.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(c.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Supprimer
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}

export function useSidebarToggle() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}