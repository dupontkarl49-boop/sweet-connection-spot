import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Key } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
}

export function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showKeyHint, setShowKeyHint] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSend(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative bg-card border border-border rounded-2xl overflow-hidden shadow-lg shadow-primary/5">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pose ta question à SIGMA..."
          disabled={isLoading}
          className="min-h-[60px] max-h-[150px] resize-none border-0 bg-transparent pr-24 text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={1}
        />
        <div className="absolute right-2 bottom-2 flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-accent"
            onClick={() => setShowKeyHint(!showKeyHint)}
          >
            <Key className="h-4 w-4" />
          </Button>
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className="h-10 w-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all duration-200"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {showKeyHint && (
        <div className="absolute bottom-full mb-2 left-0 right-0 p-3 bg-card border border-border rounded-lg text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Key className="h-4 w-4 text-accent" />
            Certaines questions nécessitent une clé secrète pour être déverrouillées. Ajoute-la à ton message si tu la connais.
          </p>
        </div>
      )}
    </form>
  );
}
