import { useState, useEffect } from 'react';

export const useEmptyStateAnimation = (enabled: boolean = true) => {
    const [animationState, setAnimationState] = useState<number>(0);

    useEffect(() => {
        if (!enabled) return;
        let timeout: NodeJS.Timeout;

        const runStateMachine = (currentState: number) => {
            timeout = setTimeout(() => {
                setAnimationState((prev) => {
                    if (prev === 0) return 1; // Try Gap 2
                    if (prev === 1) return 2; // Try Gap 3
                    if (prev === 2) return 3; // Lock Gap 3
                    if (prev === 3) return 0; // Loop back to Gap 1
                    return 0;
                });
            }, getDurationForState(animationState));
        };

        runStateMachine(animationState);

        return () => clearTimeout(timeout);
    }, [animationState, enabled]);

    const getDurationForState = (state: number) => {
        switch (state) {
            case 0: return 2000; // Hover Gap 1
            case 1: return 2000; // Hover Gap 2
            case 2: return 2000; // Hover Gap 3 
            case 3: return 4000; // Hold Locked
            default: return 2000;
        }
    };

    return animationState;
};
