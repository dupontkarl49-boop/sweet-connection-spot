import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Key, ImagePlus, X } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string, imagesBase64?: string[]) => void;
  isLoading: boolean;
}

const MAX_IMAGES = 3;

export function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showKeyHint, setShowKeyHint] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imagesBase64, setImagesBase64] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = MAX_IMAGES - imagesBase64.length;
    const toProcess = files.slice(0, remainingSlots);

    toProcess.forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      if (file.size > 10 * 1024 * 1024) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setImagePreviews((prev) => [...prev, base64]);
        setImagesBase64((prev) => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
    setImagesBase64((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((input.trim() || imagesBase64.length > 0) && !isLoading) {
      onSend(input.trim(), imagesBase64.length > 0 ? imagesBase64 : undefined);
      setInput("");
      setImagePreviews([]);
      setImagesBase64([]);
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
      {imagePreviews.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {imagePreviews.map((preview, index) => (
            <div key={index} className="relative inline-block">
              <img
                src={preview}
                alt={`Preview ${index + 1}`}
                className="h-20 w-auto rounded-lg border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="relative bg-card border border-border rounded-2xl overflow-hidden shadow-lg shadow-primary/5">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={imagesBase64.length > 0 ? "Ajoute un message pour accompagner les images..." : "Pose ta question à SIGMA..."}
          disabled={isLoading}
          className="min-h-[60px] max-h-[150px] resize-none border-0 bg-transparent pr-32 text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={1}
        />
        <div className="absolute right-2 bottom-2 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-accent relative"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || imagesBase64.length >= MAX_IMAGES}
          >
            <ImagePlus className="h-4 w-4" />
            {imagesBase64.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-accent text-accent-foreground text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                {imagesBase64.length}
              </span>
            )}
          </Button>
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
            disabled={(!input.trim() && imagesBase64.length === 0) || isLoading}
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
