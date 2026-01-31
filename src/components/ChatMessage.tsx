import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  image?: string;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, image, isStreaming }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div
      className={cn(
        "flex gap-4 p-4 rounded-xl transition-all duration-300",
        isUser
          ? "bg-secondary/50 ml-8"
          : "bg-card border border-border mr-8"
      )}
    >
      <div
        className={cn(
          "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
          isUser
            ? "bg-muted"
            : "bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30"
        )}
      >
        {isUser ? (
          <User className="w-5 h-5 text-muted-foreground" />
        ) : (
          <Bot className="w-5 h-5 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium mb-1 text-muted-foreground">
          {isUser ? "Toi" : "SIGMA"}
        </p>
        {image && (
          <img
            src={image}
            alt="Image envoyée"
            className="max-w-xs max-h-48 rounded-lg border border-border mb-2 object-contain"
          />
        )}
        <div className="text-foreground whitespace-pre-wrap break-words">
          {content}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse rounded-sm" />
          )}
        </div>
      </div>
    </div>
  );
}
