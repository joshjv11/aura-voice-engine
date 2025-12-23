import { useState } from "react";
import VoiceCallInterface from "@/components/VoiceCallInterface";
import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";

const Index = () => {
  const [isCallActive, setIsCallActive] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center w-full max-w-md">
        {!isCallActive ? (
          <div className="space-y-6 animate-fade-in">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
              Aura Voice
            </h1>
            <p className="text-xl text-muted-foreground">
              Experience the next generation of voice AI.
            </p>
            <Button 
              size="lg" 
              className="rounded-full w-20 h-20 shadow-lg hover:shadow-primary/25 transition-all duration-300"
              onClick={() => setIsCallActive(true)}
            >
              <Phone className="w-8 h-8" />
            </Button>
          </div>
        ) : (
          <VoiceCallInterface onEndCall={() => setIsCallActive(false)} />
        )}
      </div>
    </div>
  );
};

export default Index;
