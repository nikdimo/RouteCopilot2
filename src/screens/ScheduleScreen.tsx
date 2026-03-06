import React from 'react';

import ScheduleScreenNew from './ScheduleScreenNew';
import ScheduleScreenOld from './ScheduleScreenOld';
import { useDevUI } from '../context/DevUIContext';
import { useAuth } from '../context/AuthContext';

export default function ScheduleScreen() {
    const { showOldUI } = useDevUI();
    const { userToken } = useAuth();
    const isSignedIn = Boolean(userToken);

    if (!isSignedIn) {
        return <ScheduleScreenNew />;
    }

    return showOldUI ? <ScheduleScreenOld /> : <ScheduleScreenNew />;
}
