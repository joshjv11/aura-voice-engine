export interface SpeechPlan {
    originalText: string;
    spokenText: string;
    segments: {
        text: string;
        pauseAfterMs?: number;
        emotionModifier?: string;
        pace?: number; // Added for Speech Rate Drift
    }[];
}

export function planSpeech(text: string, currentEmotion: string): SpeechPlan {
    // ... (Cleaning logic remains same)
    let spoken = text
        .replace(/[\(\[\{].*?[\)\]\}]/gs, '')
        .replace(/\*/g, '')
        .replace(/_/g, ' ')
        .replace(/#/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // ... (Filler logic remains same)
    const fillers = {
        thoughtful: ['hmm...', 'well...', 'like...'],
        playful: ['haha,', 'wait,', 'you know,'],
        affectionate: ['hmm...', 'acha,'],
        neutral: ['so,', 'basically,']
    };

    const selectedFillers = fillers[currentEmotion as keyof typeof fillers] || fillers.neutral;
    const useFiller = Math.random() > 0.85;

    if (useFiller) {
        const filler = selectedFillers[Math.floor(Math.random() * selectedFillers.length)];
        spoken = `${filler} ${spoken}`;
    }

    // Segmenting
    const rawSegments = spoken.split(/([.,?!])+/).filter(s => s.trim().length > 0);
    const segments: SpeechPlan['segments'] = [];

    let currentSegment = "";

    // Helper to determine pace based on position
    // Start slow (thinking), then speed up (flowing)
    const getPace = (index: number) => index === 0 ? 0.95 : 1.05;
    let segmentIndex = 0;

    for (let i = 0; i < rawSegments.length; i++) {
        const part = rawSegments[i];

        if ([".", "?", "!"].includes(part)) {
            currentSegment += part;
            segments.push({
                text: currentSegment.trim(),
                pauseAfterMs: 600,
                pace: getPace(segmentIndex++)
            });
            currentSegment = "";
        } else if ([","].includes(part)) {
            currentSegment += part;
            segments.push({
                text: currentSegment.trim(),
                pauseAfterMs: 300,
                pace: getPace(segmentIndex++)
            });
            currentSegment = "";
        } else {
            currentSegment += part;
        }
    }

    if (currentSegment.trim()) {
        segments.push({
            text: currentSegment.trim(),
            pauseAfterMs: 0,
            pace: getPace(segmentIndex)
        });
    }

    return {
        originalText: text,
        spokenText: spoken,
        segments
    };
}
