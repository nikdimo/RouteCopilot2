import React from 'react';

import ScheduleScreenNew from './ScheduleScreenNew';
import ScheduleScreenOld from './ScheduleScreenOld';
import { useDevUI } from '../context/DevUIContext';

export default function ScheduleScreen() {
    const { showOldUI } = useDevUI();

    return showOldUI ? <ScheduleScreenOld /> : <ScheduleScreenNew />;
}
