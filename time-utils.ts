// ===================================================================
// TIME UTILITY FUNCTIONS
// For handling AM/PM filtering and 12-hour time format conversion
// ===================================================================

export interface TimeSlotConfig {
  am: boolean;
  pm: boolean;
}

/**
 * Convert military time format to 12-hour format
 * @param militaryTime - Time in format "7:30-9:00" or "13:30-15:00"
 * @returns Time in 12-hour format like "7:30 AM - 9:00 AM"
 */
export function convertTo12HourFormat(militaryTime: string): string {
  if (!militaryTime || !militaryTime.includes('-')) {
    return militaryTime;
  }

  const [startTime, endTime] = militaryTime.split('-');
  
  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':').map(part => parseInt(part.trim(), 10));
    
    if (isNaN(hours) || isNaN(minutes)) {
      return time; // Return original if parsing fails
    }
    
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

/**
 * Get filtered time slots based on AM/PM selection
 * @param amSelected - Whether AM is selected
 * @param pmSelected - Whether PM is selected
 * @returns Array of time slots in military format
 */
export function getFilteredTimeSlots(amSelected: boolean, pmSelected: boolean): string[] {
  const allSlots = [
    '7:30-9:00',    // AM
    '9:00-10:30',   // AM
    '10:30-12:00',  // AM
    '12:00-13:30',  // PM
    '13:30-15:00',  // PM
    '15:00-16:30',  // PM
    '16:30-18:00',  // PM
    '18:00-19:30'   // PM
  ];

  // If both selected, return all slots
  if (amSelected && pmSelected) {
    return allSlots;
  }

  // If only AM selected (7:30 AM - 12:00 PM)
  if (amSelected && !pmSelected) {
    return allSlots.slice(0, 3); // First 3 slots: 7:30-9:00, 9:00-10:30, 10:30-12:00
  }

  // If only PM selected (12:00 PM - 7:30 PM)
  if (!amSelected && pmSelected) {
    return allSlots.slice(3); // Last 5 slots: 12:00-13:30, 13:30-15:00, 15:00-16:30, 16:30-18:00, 18:00-19:30
  }

  // If neither selected, return empty array (or all slots as fallback)
  return [];
}

/**
 * Get display time slots (in 12-hour format) based on AM/PM selection
 * @param amSelected - Whether AM is selected
 * @param pmSelected - Whether PM is selected
 * @returns Array of time slots in 12-hour format
 */
export function getDisplayTimeSlots(amSelected: boolean, pmSelected: boolean): string[] {
  const militarySlots = getFilteredTimeSlots(amSelected, pmSelected);
  return militarySlots.map(slot => convertTo12HourFormat(slot));
}

/**
 * Check if a time slot should be included based on AM/PM configuration
 * @param slot - Time slot in military format
 * @param config - AM/PM configuration
 * @returns True if slot should be included
 */
export function isSlotIncluded(slot: string, config: TimeSlotConfig): boolean {
  const [startTime] = slot.split('-');
  const [hours] = startTime.split(':').map(part => parseInt(part.trim(), 10));
  
  // If both selected, include all slots
  if (config.am && config.pm) {
    return true;
  }
  
  // AM slots: before 12:00 (7:30-9:00, 9:00-10:30, 10:30-12:00)
  if (config.am && !config.pm) {
    return hours < 12;
  }
  
  // PM slots: 12:00 and after (12:00-13:30, 13:30-15:00, 15:00-16:30, 16:30-18:00, 18:00-19:30)
  if (!config.am && config.pm) {
    return hours >= 12;
  }
  
  return false;
}

/**
 * Get time slots configuration from exam days
 * @param examDays - Array of exam day configurations with AM/PM flags
 * @returns Map of day index to TimeSlotConfig
 */
export function getTimeSlotsConfigFromDays(examDays: { am: boolean; pm: boolean }[]): Map<number, TimeSlotConfig> {
  const configMap = new Map<number, TimeSlotConfig>();
  
  examDays.forEach((day, index) => {
    configMap.set(index, {
      am: day.am,
      pm: day.pm
    });
  });
  
  return configMap;
}

/**
 * Get filtered time slots for a specific day
 * @param dayIndex - Index of the day (0-based)
 * @param examDays - Array of exam day configurations
 * @returns Array of time slots for that day
 */
export function getTimeSlotsForDay(dayIndex: number, examDays: { am: boolean; pm: boolean }[]): string[] {
  if (dayIndex < 0 || dayIndex >= examDays.length) {
    return [];
  }
  
  const dayConfig = examDays[dayIndex];
  return getFilteredTimeSlots(dayConfig.am, dayConfig.pm);
}

/**
 * Get display time slots for a specific day
 * @param dayIndex - Index of the day (0-based)
 * @param examDays - Array of exam day configurations
 * @returns Array of time slots in 12-hour format for that day
 */
export function getDisplayTimeSlotsForDay(dayIndex: number, examDays: { am: boolean; pm: boolean }[]): string[] {
  const militarySlots = getTimeSlotsForDay(dayIndex, examDays);
  return militarySlots.map(slot => convertTo12HourFormat(slot));
}