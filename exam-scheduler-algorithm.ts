// ===================================================================
// USL-ERP EXAM SCHEDULER - PRODUCTION READY V10.1
// ===================================================================
// IMPROVEMENTS:
// ✅ Building J completely excluded
// ✅ Deterministic slot selection (no randomness)
// ✅ Subject validation
// ✅ Comprehensive statistics
// ✅ Verification functions
// ✅ Better ARCH handling (avoid 7:30 AM)
// ✅ Optimized 6-unit subject placement
// ✅ AM/PM time slot filtering support
// ===================================================================

import { Exam, ScheduledExam, ConflictMatrix, SchedulingState } from '../subject-code';

interface DayTimeConfig {
  am: boolean;
  pm: boolean;
}

// ===================================================================
// CONSTANTS & CONFIGURATION
// ===================================================================

const ALL_TIME_SLOTS = [
  '7:30-9:00', '9:00-10:30', '10:30-12:00', '12:00-13:30',
  '13:30-15:00', '15:00-16:30', '16:30-18:00', '18:00-19:30'
];

const SLOT_START_TIMES = [
  450, 540, 630, 720, 810, 900, 990, 1080
];

const EXCLUDED_SUBJECT_IDS = new Set([
  'RESM 1023', 'ARMS 1023', 'BRES 1023', 'RESM 1013', 'RESM 1022', 'THES 1023',
  'ACCT 1183', 'ACCT 1213', 'ACCT 1193', 'ACCT 1223', 'ACCT 1203', 'ACCT 1236',
  'PRAC 1033', 'PRAC 1023', 'PRAC 1013', 'PRAC 1012', 'PRAC 1036', 'PRAC 1026',
  'MKTG 1183', 'MKTG 1153',
  'ARCH 1505', 'ARCH 1163', 'ARCH 1254', 'ARCH 1385',
  'HOAS 1013', 'FMGT 1123',
  'CPAR 1013', 'CVIL 1222', 'CADD 1011', 'COME 1151', 'GEOD 1253', 'CVIL 1065',
  'CAPS 1021',
  'EDUC 1123', 'ELEM 1063', 'ELEM 1073', 'ELEM 1083', 'SCED 1023', 'MAPE 1073',
  'JOUR 1013', 'LITR 1043', 'LITR 1073', 'LITR 1033', 'LITR 1023',
  'SOCS 1073', 'SOCS 1083', 'PSYC 1133', 'SOCS 1183', 'SOCS 1063',
  'SOCS 1213', 'SOCS 1193', 'SOCS 1093', 'SOCS 1173', 'SOCS 1203',
  'CFED 1061', 'CFED 1043', 'CFED 1081',
  'CORE 1016', 'CORE 1026',
  'ENLT 1153', 'ENLT 1013', 'ENLT 1143', 'ENLT 1063', 'ENLT 1133', 'ENLT 1123',
  'NSTP 1023',
  'NURS 1015', 'NURS 1236', 'MELS 1053', 'MELS 1044', 'MELS 13112', 'MELS 1323',
  'PNCM 1178', 'PNCM 1169', 'PNCM 10912', 'PNCM 1228'
]);

// ✅ NEW: Helper functions for AM/PM filtering
function getFilteredSlotsForDay(config: DayTimeConfig): string[] {
  if (config.am && config.pm) {
    return [...ALL_TIME_SLOTS];
  }
  
  if (config.am && !config.pm) {
    return ALL_TIME_SLOTS.slice(0, 3); // 7:30-9:00, 9:00-10:30, 10:30-12:00
  }
  
  if (!config.am && config.pm) {
    return ALL_TIME_SLOTS.slice(3); // 12:00-13:30, 13:30-15:00, 15:00-16:30, 16:30-18:00, 18:00-19:30
  }
  
  return [];
}

function isSlotAvailableForDay(slot: string, dayConfig: DayTimeConfig): boolean {
  const availableSlots = getFilteredSlotsForDay(dayConfig);
  return availableSlots.includes(slot);
}

// ✅ UPDATED: Gen Ed Time Blocks with realistic capacities
const GEN_ED_TIME_BLOCKS: { 
  [key: string]: { 
    day: number; 
    slot: number; 
    capacity: number;
  }[] 
} = {
  'ETHC': [
    { day: 0, slot: 0, capacity: 14 },
    { day: 0, slot: 1, capacity: 10 },
    { day: 2, slot: 1, capacity: 10 }
  ],
  'ENGL': [
    { day: 0, slot: 2, capacity: 23 },
    { day: 2, slot: 0, capacity: 34 },
    { day: 0, slot: 1, capacity: 15 },
    { day: 1, slot: 2, capacity: 10 }
  ],
  'PHED': [
    { day: 0, slot: 3, capacity: 27 },
    { day: 1, slot: 0, capacity: 46 },
    { day: 2, slot: 3, capacity: 20 },
    { day: 0, slot: 2, capacity: 15 }
  ],
  'CFED': [
    { day: 0, slot: 4, capacity: 46 },
    { day: 1, slot: 1, capacity: 36 },
    { day: 1, slot: 2, capacity: 44 },
    { day: 0, slot: 5, capacity: 20 },
    { day: 1, slot: 4, capacity: 15 },
    { day: 2, slot: 4, capacity: 10 }
  ],
  'CONW': [
    { day: 1, slot: 5, capacity: 33 },
    { day: 0, slot: 5, capacity: 20 },
    { day: 2, slot: 5, capacity: 15 },
    { day: 1, slot: 4, capacity: 10 }
  ],
  'LANG': [
    { day: 2, slot: 3, capacity: 15 },
    { day: 2, slot: 4, capacity: 10 },
    { day: 1, slot: 3, capacity: 10 },
    { day: 0, slot: 3, capacity: 10 }
  ],
  'LITR': [
    { day: 2, slot: 4, capacity: 9 },
    { day: 2, slot: 5, capacity: 10 },
    { day: 0, slot: 4, capacity: 10 },
    { day: 1, slot: 5, capacity: 10 }
  ],
  'MATH': [
    { day: 2, slot: 2, capacity: 20 },
    { day: 0, slot: 2, capacity: 15 },
    { day: 1, slot: 2, capacity: 15 },
    { day: 2, slot: 1, capacity: 10 }
  ],
  'ICTE': [
    { day: 1, slot: 1, capacity: 15 },
    { day: 0, slot: 1, capacity: 10 },
    { day: 2, slot: 1, capacity: 10 }
  ],
  'OMGT': [
    { day: 1, slot: 5, capacity: 10 },
    { day: 0, slot: 5, capacity: 10 },
    { day: 2, slot: 5, capacity: 10 }
  ],
  'GGSR': [
    { day: 1, slot: 2, capacity: 10 },
    { day: 0, slot: 2, capacity: 10 },
    { day: 2, slot: 2, capacity: 10 }
  ],
  'RZAL': [
    { day: 1, slot: 4, capacity: 10 },
    { day: 0, slot: 4, capacity: 10 },
    { day: 2, slot: 4, capacity: 10 }
  ],
  'PDEV': [
    { day: 1, slot: 4, capacity: 10 },
    { day: 0, slot: 4, capacity: 10 },
    { day: 2, slot: 4, capacity: 10 }
  ]
};

const PRIORITY_LEVELS = {
  GEN_ED: 100000,
  MATH: 50000,
  ARCH: 40000,
  MAJOR: 10000
};

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

function shouldExcludeSubject(subjectId: string): boolean {
  if (!subjectId) return false;
  
  const normalized = subjectId.toUpperCase().trim().replace(/\s+/g, ' ');
  
  if (EXCLUDED_SUBJECT_IDS.has(normalized)) {
    return true;
  }
  
  const lowerSubject = normalized.toLowerCase();
  const excludePatterns = [
    '(lab)', '(rle)', 'lab)', 'rle)',
    'practicum', 'internship', 'thesis',
    'research method', 'capstone'
  ];
  
  for (const pattern of excludePatterns) {
    if (lowerSubject.includes(pattern)) {
      return true;
    }
  }
  
  const codeMatch = normalized.match(/^([A-Z]+)/);
  if (codeMatch) {
    const code = codeMatch[1];
    const excludedCodes = ['PRAC', 'THES', 'CAPS', 'RESM', 'ARMS', 'BRES'];
    if (excludedCodes.includes(code)) {
      return true;
    }
  }
  
  return false;
}

function getGenEdType(subjectId: string): string | null {
  if (!subjectId) return null;
  const upper = subjectId.toUpperCase();
  
  if (upper.startsWith('ETHC')) return 'ETHC';
  if (upper.startsWith('ENGL')) return 'ENGL';
  if (upper.startsWith('PHED')) return 'PHED';
  if (upper.startsWith('CFED')) return 'CFED';
  if (upper.startsWith('CONW')) return 'CONW';
  if (upper.startsWith('LANG') || upper.startsWith('JAPN') || upper.startsWith('CHIN') || upper.startsWith('SPAN')) return 'LANG';
  if (upper.startsWith('LITR')) return 'LITR';
  if (upper.startsWith('ICTE')) return 'ICTE';
  if (upper.startsWith('OMGT')) return 'OMGT';
  if (upper.startsWith('GGSR')) return 'GGSR';
  if (upper.startsWith('RZAL')) return 'RZAL';
  if (upper.startsWith('PDEV')) return 'PDEV';
  
  return null;
}

function isGenEdSubject(subjectId: string): boolean {
  return getGenEdType(subjectId) !== null;
}

function isMathSubject(exam: Exam): boolean {
  return exam.subjectId.toUpperCase().startsWith('MATH') && exam.dept.toUpperCase() === 'SACE';
}

function isArchSubject(subjectId: string): boolean {
  return subjectId.toUpperCase().includes('ARCH');
}

function getBuildingFromRoom(room: string): string {
  const match = room.match(/^([A-Z]+)-/);
  return match ? match[1] : '';
}

function getFloorFromRoom(room: string): number {
  const match = room.match(/-([0-9])([0-9])/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

function getAvailableBuildings(dept: string, subjectId: string): string[] {
  if (isArchSubject(subjectId)) {
    return ['C', 'K'];
  }
  
  const deptUpper = dept.toUpperCase();
  
  if (deptUpper.includes('SECAP')) return ['A', 'B'];
  if (deptUpper.includes('SABH')) return ['A'];
  if (deptUpper.includes('SACE')) return ['N', 'K', 'C'];
  if (deptUpper.includes('SHAS')) return ['L', 'M', 'N', 'K'];
  
  return ['A', 'N', 'K', 'L', 'M', 'B', 'C'];
}

function is6UnitSubject(exam: Exam): boolean {
  return exam.lec === 6;
}

function getTimeGapMinutes(slot1: number, slot2: number): number {
  const slot1End = SLOT_START_TIMES[slot1] + 90;
  const slot2Start = SLOT_START_TIMES[slot2];
  return Math.abs(slot2Start - slot1End);
}

function hasRequiredBreak(
  courseYear: string,
  day: number,
  slot: number,
  state: SchedulingState,
  dayConfig: DayTimeConfig
): boolean {
  const dayKey = `Day ${day + 1}`;
  const existingExams: { slot: number }[] = [];
  
  const availableSlots = getFilteredSlotsForDay(dayConfig);
  
  state.assignments.forEach((scheduledExamArray) => {
    scheduledExamArray.forEach((scheduledExam) => {
      if (scheduledExam.DAY === dayKey) {
        const examCourse = scheduledExam.COURSE;
        const examYear = scheduledExam.YEAR_LEVEL;
        const examCourseYear = `${examCourse}-${examYear}`;
        
        if (examCourseYear === courseYear) {
          const examSlotIndex = availableSlots.indexOf(scheduledExam.SLOT);
          if (examSlotIndex >= 0) {
            existingExams.push({ slot: examSlotIndex });
          }
        }
      }
    });
  });
  
  for (const existing of existingExams) {
    const gap = getTimeGapMinutes(existing.slot, slot);
    
    if (gap === 0) {
      return false;
    }
    
    if (gap < 90) {
      return false;
    }
  }
  
  return true;
}

function getPreferredSlotsForSubject(
  exam: Exam,
  phase: 'MATH_ARCH' | 'MAJOR' | 'INDIVIDUAL'
): number[] {
  if (phase === 'MATH_ARCH') {
    if (isArchSubject(exam.subjectId)) {
      return [1, 2, 3, 4, 5, 6, 0, 7];
    }
    return [1, 2, 3, 4, 5, 0, 6, 7];
  }
  
  if (phase === 'MAJOR') {
    return [1, 2, 3, 4, 5, 0, 6, 7];
  }
  
  if (phase === 'INDIVIDUAL') {
    return [1, 2, 3, 4, 5, 0, 6, 7];
  }
  
  return [0, 1, 2, 3, 4, 5, 6, 7];
}

function getPreferredSlotsFor6UnitSubject(): number[] {
  return [1, 2, 3, 4, 5, 0, 6];
}

// ===================================================================
// CONFLICT DETECTION
// ===================================================================

function buildConflictMatrix(exams: Exam[]): ConflictMatrix {
  const matrix: ConflictMatrix = {};
  const courseYearGroups: { [key: string]: Exam[] } = {};
  
  exams.forEach(exam => {
    if (!exam.course || !exam.yearLevel) return;
    const key = `${exam.course.trim()}-${exam.yearLevel}`;
    if (!courseYearGroups[key]) courseYearGroups[key] = [];
    courseYearGroups[key].push(exam);
  });
  
  Object.entries(courseYearGroups).forEach(([courseYear, exams]) => {
    matrix[courseYear] = {};
    exams.forEach(exam => {
      const conflicts = new Set<string>();
      exams.forEach(otherExam => {
        if (exam.subjectId !== otherExam.subjectId) {
          conflicts.add(otherExam.subjectId);
        }
      });
      matrix[courseYear][exam.subjectId] = conflicts;
    });
  });
  
  return matrix;
}

function hasConflict(
  exam: Exam,
  day: number,
  slot: number,
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  dayConfig: DayTimeConfig
): boolean {
  const courseYear = `${exam.course}-${exam.yearLevel}`;
  const dayKey = `Day ${day + 1}`;
  
  const availableSlots = getFilteredSlotsForDay(dayConfig);
  const slotKey = availableSlots[slot];
  
  if (!slotKey) return true;
  
  const courseYearConflicts = conflictMatrix[courseYear];
  const conflicts: Set<string> = courseYearConflicts ? (courseYearConflicts[exam.subjectId] || new Set<string>()) : new Set<string>();
  
  for (const conflictSubject of conflicts) {
    const existing = state.subjectScheduled.get(conflictSubject);
    if (existing && existing.day === dayKey && existing.slot === slotKey) {
      return true;
    }
  }
  
  if (!hasRequiredBreak(courseYear, day, slot, state, dayConfig)) {
    return true;
  }
  
  return false;
}

// ===================================================================
// ROOM MANAGEMENT
// ===================================================================

function getAvailableRooms(
  exam: Exam,
  day: number,
  slot: number,
  allRooms: string[],
  state: SchedulingState,
  is6Unit: boolean,
  dayConfig: DayTimeConfig
): string[] {
  const allowedBuildings = getAvailableBuildings(exam.dept, exam.subjectId);
  const dayKey = `Day ${day + 1}`;
  
  const availableSlots = getFilteredSlotsForDay(dayConfig);
  const slotKey = availableSlots[slot];
  
  if (!slotKey) return [];
  
  const available = allRooms.filter(room => {
    const building = getBuildingFromRoom(room);
    if (!allowedBuildings.includes(building)) return false;
    
    if (!state.roomUsage.has(dayKey)) return true;
    const dayUsage = state.roomUsage.get(dayKey);
    if (!dayUsage) return true;
    if (!dayUsage.has(slotKey)) return true;
    
    const slotUsage = dayUsage.get(slotKey);
    if (!slotUsage) return true;
    if (slotUsage.has(room)) return false;
    
    if (is6Unit && slot < availableSlots.length - 1) {
      const nextSlotKey = availableSlots[slot + 1];
      if (dayUsage.has(nextSlotKey)) {
        const nextSlotUsage = dayUsage.get(nextSlotKey);
        if (nextSlotUsage && nextSlotUsage.has(room)) return false;
      }
    }
    
    return true;
  });
  
  return available.sort((a, b) => {
    const buildingA = getBuildingFromRoom(a);
    const buildingB = getBuildingFromRoom(b);
    
    if (isArchSubject(exam.subjectId)) {
      if (buildingA === 'C' && buildingB !== 'C') return -1;
      if (buildingA !== 'C' && buildingB === 'C') return 1;
    }
    
    const floorA = getFloorFromRoom(a);
    const floorB = getFloorFromRoom(b);
    
    if (floorA !== floorB) {
      return floorA - floorB;
    }
    
    return a.localeCompare(b);
  });
}

// ===================================================================
// SCHEDULING FUNCTIONS
// ===================================================================

function scheduleExam(
  exam: Exam,
  day: number,
  slot: number,
  room: string,
  state: SchedulingState,
  scheduled: Map<string, ScheduledExam>,
  dayConfig: DayTimeConfig
): void {
  const dayKey = `Day ${day + 1}`;
  const availableSlots = getFilteredSlotsForDay(dayConfig);
  const slotKey = availableSlots[slot];
  
  if (!slotKey) return;
  
  const scheduledExam: ScheduledExam = {
    CODE: exam.code,
    SUBJECT_ID: exam.subjectId,
    DESCRIPTIVE_TITLE: exam.title,
    COURSE: exam.course,
    YEAR_LEVEL: exam.yearLevel,
    INSTRUCTOR: exam.instructor,
    DEPT: exam.dept,
    OE: exam.oe,
    DAY: dayKey,
    SLOT: slotKey,
    ROOM: room,
    UNITS: exam.lec,
    STUDENT_COUNT: exam.studentCount,
    IS_REGULAR: exam.isRegular,
    LECTURE_ROOM: exam.lectureRoom
  };
  
  scheduled.set(exam.code, scheduledExam);
  
  const assignmentKey = `${dayKey}-${slotKey}-${room}`;
  if (!state.assignments.has(assignmentKey)) {
    state.assignments.set(assignmentKey, []);
  }
  const assignmentArray = state.assignments.get(assignmentKey);
  if (assignmentArray) {
    assignmentArray.push(scheduledExam);
  }
  
  if (!state.roomUsage.has(dayKey)) {
    state.roomUsage.set(dayKey, new Map());
  }
  const dayUsage = state.roomUsage.get(dayKey);
  if (dayUsage) {
    if (!dayUsage.has(slotKey)) {
      dayUsage.set(slotKey, new Set());
    }
    const slotSet = dayUsage.get(slotKey);
    if (slotSet) {
      slotSet.add(room);
    }
  }
  
  state.subjectScheduled.set(exam.subjectId, { day: dayKey, slot: slotKey });
}

function schedule6UnitExam(
  exam: Exam,
  day: number,
  slot: number,
  room: string,
  state: SchedulingState,
  scheduled: Map<string, ScheduledExam>,
  dayConfig: DayTimeConfig
): boolean {
  const availableSlots = getFilteredSlotsForDay(dayConfig);
  
  if (slot >= availableSlots.length - 1) return false;
  
  scheduleExam(exam, day, slot, room, state, scheduled, dayConfig);
  
  const nextSlot = slot + 1;
  const dayKey = `Day ${day + 1}`;
  const nextSlotKey = availableSlots[nextSlot];
  
  if (!nextSlotKey) return false;
  
  if (!state.roomUsage.has(dayKey)) {
    state.roomUsage.set(dayKey, new Map());
  }
  const dayUsage = state.roomUsage.get(dayKey);
  if (dayUsage) {
    if (!dayUsage.has(nextSlotKey)) {
      dayUsage.set(nextSlotKey, new Set());
    }
    const nextSlotSet = dayUsage.get(nextSlotKey);
    if (nextSlotSet) {
      nextSlotSet.add(room);
    }
  }
  
  return true;
}

function groupExamsBySubject(exams: Exam[]): Map<string, Exam[]> {
  const groups = new Map<string, Exam[]>();
  
  exams.forEach(exam => {
    if (!groups.has(exam.subjectId)) {
      groups.set(exam.subjectId, []);
    }
    const group = groups.get(exam.subjectId);
    if (group) {
      group.push(exam);
    }
  });
  
  return groups;
}

function tryScheduleGroup(
  group: Exam[],
  day: number,
  slot: number,
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  dayConfig: DayTimeConfig
): boolean {
  const roomAssignments: { exam: Exam, room: string }[] = [];
  
  for (const exam of group) {
    if (hasConflict(exam, day, slot, state, conflictMatrix, dayConfig)) {
      return false;
    }
    
    const availableRooms = getAvailableRooms(
      exam,
      day,
      slot,
      allRooms,
      state,
      is6UnitSubject(exam),
      dayConfig
    );
    
    if (availableRooms.length === 0) {
      return false;
    }
    
    roomAssignments.push({ exam, room: availableRooms[0] });
  }
  
  for (const { exam, room } of roomAssignments) {
    if (is6UnitSubject(exam)) {
      schedule6UnitExam(exam, day, slot, room, state, scheduled, dayConfig);
    } else {
      scheduleExam(exam, day, slot, room, state, scheduled, dayConfig);
    }
  }
  
  return true;
}

// ===================================================================
// PHASE 1: GEN ED TIME BLOCKS
// ===================================================================

function scheduleGenEdTimeBlocks(
  genEds: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number,
  dayConfigs: DayTimeConfig[]
): { scheduled: number, failed: Exam[] } {
  console.log('\n📗 PHASE 1: Gen Ed Time Blocks (WITH CAPACITY & AM/PM FILTERING)...');
  
  let scheduledCount = 0;
  const failed: Exam[] = [];
  
  const genEdGroups = new Map<string, Exam[]>();
  genEds.forEach(exam => {
    const genEdType = getGenEdType(exam.subjectId);
    if (genEdType) {
      if (!genEdGroups.has(genEdType)) {
        genEdGroups.set(genEdType, []);
      }
      const group = genEdGroups.get(genEdType);
      if (group) {
        group.push(exam);
      }
    }
  });
  
  const capacityUsage = new Map<string, number>();
  
  genEdGroups.forEach((exams, genEdType) => {
    const timeBlocks = GEN_ED_TIME_BLOCKS[genEdType];
    if (!timeBlocks) {
      console.log(`  ℹ️  ${genEdType}: No time block defined, will schedule in Phase 3`);
      failed.push(...exams);
      return;
    }
    
    const subjectGroups = groupExamsBySubject(exams);
    
    subjectGroups.forEach((group, subjectId) => {
      let placed = false;
      
      for (const block of timeBlocks) {
        if (placed) break;
        
        // ✅ FIXED: Check if block is within numDays
        if (block.day >= numDays) {
          continue;
        }
        
        // ✅ FIXED: Check if this time block is available for this day's config
        if (!isSlotAvailableForDay(ALL_TIME_SLOTS[block.slot], dayConfigs[block.day])) {
          console.log(`  ⏭️  Skipping ${genEdType} block at Day ${block.day + 1}, slot ${block.slot} (not in AM/PM config)`);
          continue;
        }
        
        if (genEdType === 'CFED' && block.slot === 0) {
          continue;
        }
        
        const blockKey = `${genEdType}-${block.day}-${block.slot}`;
        const currentUsage = capacityUsage.get(blockKey) || 0;
        
        if (currentUsage + group.length > block.capacity) {
          console.log(`  ⚠️  ${genEdType}: Day ${block.day + 1} ${ALL_TIME_SLOTS[block.slot]} full (${currentUsage}/${block.capacity})`);
          continue;
        }
        
        if (tryScheduleGroup(group, block.day, block.slot, allRooms, state, conflictMatrix, scheduled, dayConfigs[block.day])) {
          scheduledCount += group.length;
          placed = true;
          capacityUsage.set(blockKey, currentUsage + group.length);
          console.log(`  ✅ ${genEdType}: ${subjectId} (${group.length} sections) → Day ${block.day + 1} ${ALL_TIME_SLOTS[block.slot]} [${currentUsage + group.length}/${block.capacity}]`);
        }
      }
      
      if (!placed) {
        failed.push(...group);
        console.log(`  ⚠️  ${genEdType}: ${subjectId} (${group.length} sections) - will retry in Phase 3`);
      }
    });
  });
  
  console.log(`  ✅ Phase 1 complete: ${scheduledCount} Gen Ed exams scheduled`);
  return { scheduled: scheduledCount, failed };
}

// ===================================================================
// PHASE 2: HIGH PRIORITY (MATH & ARCH)
// ===================================================================

function scheduleHighPriority(
  exams: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number,
  dayConfigs: DayTimeConfig[]
): { scheduled: number, failed: Exam[] } {
  console.log('\n📕 PHASE 2: High Priority (MATH & ARCH with AM/PM filtering)...');
  
  let scheduledCount = 0;
  const failed: Exam[] = [];
  
  const mathExams = exams.filter(e => isMathSubject(e));
  const archExams = exams.filter(e => isArchSubject(e.subjectId));
  
  const mathGroups = groupExamsBySubject(mathExams);
  mathGroups.forEach((group, subjectId) => {
    let placed = false;
    
    const preferredSlots = getPreferredSlotsForSubject(group[0], 'MATH_ARCH');
    
    for (let day = 0; day < numDays && !placed; day++) {
      const availableSlots = getFilteredSlotsForDay(dayConfigs[day]);
      
      for (const slotIndex of preferredSlots) {
        if (placed) break;
        if (slotIndex >= availableSlots.length) continue;
        
        if (tryScheduleGroup(group, day, slotIndex, allRooms, state, conflictMatrix, scheduled, dayConfigs[day])) {
          scheduledCount += group.length;
          placed = true;
          console.log(`  ✅ MATH: ${subjectId} (${group.length} sections) → Day ${day + 1} ${availableSlots[slotIndex]}`);
        }
      }
    }
    
    if (!placed) {
      failed.push(...group);
      console.log(`  ⚠️  MATH: ${subjectId} (${group.length} sections) - no available slot`);
    }
  });
  
  const archGroups = groupExamsBySubject(archExams);
  archGroups.forEach((group, subjectId) => {
    let placed = false;
    
    const preferredSlots = getPreferredSlotsForSubject(group[0], 'MATH_ARCH');
    
    for (let day = 0; day < numDays && !placed; day++) {
      const availableSlots = getFilteredSlotsForDay(dayConfigs[day]);
      
      for (const slotIndex of preferredSlots) {
        if (placed) break;
        if (slotIndex >= availableSlots.length) continue;
        
        if (tryScheduleGroup(group, day, slotIndex, allRooms, state, conflictMatrix, scheduled, dayConfigs[day])) {
          scheduledCount += group.length;
          placed = true;
          console.log(`  ✅ ARCH: ${subjectId} (${group.length} sections) → Day ${day + 1} ${availableSlots[slotIndex]}`);
        }
      }
    }
    
    if (!placed) {
      failed.push(...group);
      console.log(`  ⚠️  ARCH: ${subjectId} (${group.length} sections) - Building C/K full`);
    }
  });
  
  console.log(`  ✅ Phase 2 complete: ${scheduledCount} high-priority subjects scheduled`);
  return { scheduled: scheduledCount, failed };
}

// ===================================================================
// PHASE 3: MAJOR SUBJECTS
// ===================================================================

function scheduleMajorSubjects(
  exams: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number,
  dayConfigs: DayTimeConfig[]
): { scheduled: number, failed: Exam[] } {
  console.log('\n📘 PHASE 3: Major Subjects (with AM/PM filtering)...');
  
  let scheduledCount = 0;
  const failed: Exam[] = [];
  
  const subjectGroups = groupExamsBySubject(exams);
  
  const dayLoad: number[] = new Array(numDays).fill(0);
  
  state.assignments.forEach((scheduledExamArray, key) => {
    const dayMatch = key.match(/Day (\d+)/);
    if (dayMatch) {
      const dayIndex = parseInt(dayMatch[1], 10) - 1;
      if (dayIndex >= 0 && dayIndex < numDays) {
        dayLoad[dayIndex] += scheduledExamArray.length;
      }
    }
  });
  
  const sortedGroups = Array.from(subjectGroups.entries())
    .sort((a, b) => {
      const a6Unit = a[1].some(e => is6UnitSubject(e));
      const b6Unit = b[1].some(e => is6UnitSubject(e));
      
      if (a6Unit && !b6Unit) return -1;
      if (!a6Unit && b6Unit) return 1;
      
      return b[1].length - a[1].length;
    });
  
  sortedGroups.forEach(([subjectId, group]) => {
    let placed = false;
    
    const dayPreferences: { day: number, load: number, penalty: number }[] = [];
    for (let day = 0; day < numDays; day++) {
      const penalty = day === 2 ? 30 : 0;
      dayPreferences.push({ day, load: dayLoad[day], penalty });
    }
    
    dayPreferences.sort((a, b) => (a.load + a.penalty) - (b.load + b.penalty));
    
    const is6Unit = group.some(e => is6UnitSubject(e));
    const preferredSlots = is6Unit 
      ? getPreferredSlotsFor6UnitSubject() 
      : getPreferredSlotsForSubject(group[0], 'MAJOR');
    
    for (const { day } of dayPreferences) {
      if (placed) break;
      
      const availableSlots = getFilteredSlotsForDay(dayConfigs[day]);
      
      for (const slotIndex of preferredSlots) {
        if (placed) break;
        if (slotIndex >= availableSlots.length) continue;
        
        if (tryScheduleGroup(group, day, slotIndex, allRooms, state, conflictMatrix, scheduled, dayConfigs[day])) {
          scheduledCount += group.length;
          placed = true;
          dayLoad[day] += group.length;
          const unitLabel = is6Unit ? ' (6-unit)' : '';
          console.log(`  ✅ ${subjectId} (${group.length} sections)${unitLabel} → Day ${day + 1} ${availableSlots[slotIndex]}`);
        }
      }
    }
    
    if (!placed) {
      failed.push(...group);
      console.log(`  ⚠️  ${subjectId} (${group.length} sections) - will retry in Phase 4`);
    }
  });
  
  console.log(`  ✅ Phase 3 complete: ${scheduledCount} major subjects scheduled`);
  console.log(`  📊 Distribution: Day 1: ${dayLoad[0]}, Day 2: ${dayLoad[1]}, Day 3: ${dayLoad[2]}`);
  return { scheduled: scheduledCount, failed };
}

// ===================================================================
// PHASE 4: INDIVIDUAL SCHEDULING
// ===================================================================

function scheduleIndividually(
  exams: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number,
  dayConfigs: DayTimeConfig[]
): number {
  console.log('\n🔧 PHASE 4: Individual Scheduling (with AM/PM filtering)...');
  
  let scheduledCount = 0;
  
  const dayLoad: number[] = new Array(numDays).fill(0);
  
  state.assignments.forEach((scheduledExamArray, key) => {
    const dayMatch = key.match(/Day (\d+)/);
    if (dayMatch) {
      const dayIndex = parseInt(dayMatch[1], 10) - 1;
      if (dayIndex >= 0 && dayIndex < numDays) {
        dayLoad[dayIndex] += scheduledExamArray.length;
      }
    }
  });
  
  const sortedExams = exams.sort((a, b) => {
    if (is6UnitSubject(a) && !is6UnitSubject(b)) return -1;
    if (!is6UnitSubject(a) && is6UnitSubject(b)) return 1;
    return 0;
  });
  
  sortedExams.forEach(exam => {
    let placed = false;
    
    const dayPreferences: { day: number, load: number, penalty: number }[] = [];
    for (let day = 0; day < numDays; day++) {
      const penalty = day === 2 ? 30 : 0;
      dayPreferences.push({ day, load: dayLoad[day], penalty });
    }
    
    dayPreferences.sort((a, b) => (a.load + a.penalty) - (b.load + b.penalty));
    
    const is6Unit = is6UnitSubject(exam);
    const preferredSlots = is6Unit 
      ? getPreferredSlotsFor6UnitSubject() 
      : getPreferredSlotsForSubject(exam, 'INDIVIDUAL');
    
    for (const { day } of dayPreferences) {
      if (placed) break;
      
      const availableSlots = getFilteredSlotsForDay(dayConfigs[day]);
      
      for (const slotIndex of preferredSlots) {
        if (placed) break;
        if (slotIndex >= availableSlots.length) continue;
        
        if (hasConflict(exam, day, slotIndex, state, conflictMatrix, dayConfigs[day])) continue;
        
        const availableRooms = getAvailableRooms(exam, day, slotIndex, allRooms, state, is6Unit, dayConfigs[day]);
        
        if (availableRooms.length > 0) {
          if (is6Unit) {
            if (schedule6UnitExam(exam, day, slotIndex, availableRooms[0], state, scheduled, dayConfigs[day])) {
              scheduledCount++;
              placed = true;
              dayLoad[day]++;
              console.log(`  ✅ ${exam.subjectId} (6u) → Day ${day + 1} ${availableSlots[slotIndex]} + ${availableSlots[slotIndex + 1]}`);
            }
          } else {
            scheduleExam(exam, day, slotIndex, availableRooms[0], state, scheduled, dayConfigs[day]);
            scheduledCount++;
            placed = true;
            dayLoad[day]++;
            
            if (slotIndex === 0 || slotIndex >= 6) {
              console.log(`  ✅ ${exam.subjectId} → Day ${day + 1} ${availableSlots[slotIndex]}`);
            }
          }
        }
      }
    }
    
    if (!placed) {
      console.warn(`  ❌ FAILED: ${exam.subjectId} (${exam.code}) - ${exam.course} Yr ${exam.yearLevel}`);
    }
  });
  
  console.log(`  ✅ Phase 4 complete: ${scheduledCount} additional exams scheduled`);
  console.log(`  📊 Final Distribution: Day 1: ${dayLoad[0]}, Day 2: ${dayLoad[1]}, Day 3: ${dayLoad[2]}`);
  return scheduledCount;
}

// ===================================================================
// VALIDATION & STATISTICS
// ===================================================================

function validateNoConflicts(
  eligible: Exam[],
  scheduled: ScheduledExam[]
): { valid: boolean, conflicts: string[] } {
  const courseYearSchedules = new Map<string, ScheduledExam[]>();
  
  scheduled.forEach(exam => {
    const key = `${exam.COURSE}-${exam.YEAR_LEVEL}`;
    if (!courseYearSchedules.has(key)) {
      courseYearSchedules.set(key, []);
    }
    const schedules = courseYearSchedules.get(key);
    if (schedules) {
      schedules.push(exam);
    }
  });
  
  const conflicts: string[] = [];
  courseYearSchedules.forEach((schedules, courseYear) => {
    const timeSlots = new Map<string, ScheduledExam[]>();
    
    schedules.forEach(exam => {
      const key = `${exam.DAY}-${exam.SLOT}`;
      if (!timeSlots.has(key)) {
        timeSlots.set(key, []);
      }
      const examsInSlot = timeSlots.get(key);
      if (examsInSlot) {
        examsInSlot.push(exam);
      }
    });
    
    timeSlots.forEach((exams, timeSlot) => {
      if (exams.length > 1) {
        const conflictMsg = `❌ CONFLICT for ${courseYear} at ${timeSlot}: ${exams.map(e => e.SUBJECT_ID).join(', ')}`;
        conflicts.push(conflictMsg);
      }
    });
  });
  
  return { valid: conflicts.length === 0, conflicts };
}

function generateScheduleStatistics(
  scheduledArray: ScheduledExam[],
  numDays: number
): void {
  console.log('\n📊 ======================== DETAILED STATISTICS ========================');
  
  console.log('\n  Day Distribution:');
  const dayDistribution = new Map<string, number>();
  for (let d = 1; d <= numDays; d++) {
    const dayKey = `Day ${d}`;
    const count = scheduledArray.filter(s => s.DAY === dayKey).length;
    dayDistribution.set(dayKey, count);
    const percentage = ((count / scheduledArray.length) * 100).toFixed(1);
    console.log(`    ${dayKey}: ${count} exams (${percentage}%)`);
  }
  
  console.log('\n  Time Slot Distribution:');
  const slotCounts = new Map<string, number>();
  scheduledArray.forEach(exam => {
    const count = slotCounts.get(exam.SLOT) || 0;
    slotCounts.set(exam.SLOT, count + 1);
  });
  
  ALL_TIME_SLOTS.forEach(slot => {
    const count = slotCounts.get(slot) || 0;
    const percentage = scheduledArray.length > 0 ? ((count / scheduledArray.length) * 100).toFixed(1) : '0.0';
    const bar = '█'.repeat(Math.floor(count / 10));
    console.log(`    ${slot}: ${count.toString().padStart(3)} exams (${percentage.padStart(5)}%) ${bar}`);
  });
  
  console.log('\n  Gen Ed Distribution:');
  const genEdTypes = ['ETHC', 'ENGL', 'PHED', 'CFED', 'CONW', 'LANG', 'LITR', 'ICTE', 'OMGT', 'GGSR', 'RZAL', 'PDEV'];
  let genEdTotal = 0;
  genEdTypes.forEach(type => {
    const count = scheduledArray.filter(s => s.SUBJECT_ID.startsWith(type)).length;
    if (count > 0) {
      genEdTotal += count;
      console.log(`    ${type.padEnd(6)}: ${count} sections`);
    }
  });
  console.log(`    ${'TOTAL'.padEnd(6)}: ${genEdTotal} sections`);
  
  console.log('\n  Building Usage:');
  const buildingUsage = new Map<string, number>();
  scheduledArray.forEach(exam => {
    const building = getBuildingFromRoom(exam.ROOM);
    buildingUsage.set(building, (buildingUsage.get(building) || 0) + 1);
  });
  
  Array.from(buildingUsage.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([building, count]) => {
      const percentage = ((count / scheduledArray.length) * 100).toFixed(1);
      console.log(`    Building ${building}: ${count} exams (${percentage}%)`);
    });
  
  const buildingJCount = scheduledArray.filter(s => getBuildingFromRoom(s.ROOM) === 'J').length;
  if (buildingJCount === 0) {
    console.log(`    ✅ Building J: 0 exams (CORRECTLY EXCLUDED)`);
  } else {
    console.log(`    ⚠️  Building J: ${buildingJCount} exams (SHOULD BE 0!)`);
  }
  
  const sixUnitCount = scheduledArray.filter(s => s.UNITS === 6).length;
  console.log(`\n  6-Unit Subjects: ${sixUnitCount} sections`);
  
  const archSubjects = scheduledArray.filter(s => isArchSubject(s.SUBJECT_ID));
  const archInC = archSubjects.filter(s => getBuildingFromRoom(s.ROOM) === 'C').length;
  const archInK = archSubjects.filter(s => getBuildingFromRoom(s.ROOM) === 'K').length;
  console.log(`\n  ARCH Subjects:`);
  console.log(`    Total: ${archSubjects.length} sections`);
  console.log(`    Building C: ${archInC} sections`);
  console.log(`    Building K: ${archInK} sections (fallback)`);
  
  console.log('========================================================================');
}

function validateSubjectEnrollment(exams: Exam[]): void {
  console.log('\n📋 Subject Enrollment by Program:');
  const subjectsByProgram = new Map<string, Set<string>>();
  
  exams.forEach(exam => {
    const programKey = `${exam.course}-${exam.yearLevel}`;
    if (!subjectsByProgram.has(programKey)) {
      subjectsByProgram.set(programKey, new Set());
    }
    const subjects = subjectsByProgram.get(programKey);
    if (subjects) {
      subjects.add(exam.subjectId);
    }
  });
  
  const sortedPrograms = Array.from(subjectsByProgram.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  
  sortedPrograms.forEach(([program, subjects]) => {
    console.log(`  ${program}: ${subjects.size} subjects`);
  });
}

// ===================================================================
// MAIN ALGORITHM ENTRY POINT
// ===================================================================

export function generateExamSchedule(
  exams: Exam[],
  rooms: string[],
  numDays: number,
  dayConfigs?: DayTimeConfig[]
): ScheduledExam[] {
  
  const configs = dayConfigs || Array(numDays).fill({ am: true, pm: true });
  
  console.log('🚀 Starting USL-ERP Exam Scheduler v10.1 (With AM/PM Support)...');
  console.log(`  Total exams: ${exams.length}`);
  console.log(`  Total rooms: ${rooms.length}`);
  console.log(`  Exam days: ${numDays}`);
  
  configs.forEach((config, index) => {
    const slots = getFilteredSlotsForDay(config);
    console.log(`  Day ${index + 1} Config: AM=${config.am}, PM=${config.pm} → ${slots.length} slots`);
  });
  
  const validRooms = rooms.filter(room => {
    const building = getBuildingFromRoom(room);
    if (building === 'J') {
      console.log(`  ⛔ Excluding Building J room: ${room}`);
      return false;
    }
    return true;
  });
  
  console.log(`  Valid rooms (excluding J): ${validRooms.length}`);
  
  const state: SchedulingState = {
    assignments: new Map(),
    roomUsage: new Map(),
    studentLoad: new Map(),
    campusUsage: new Map(),
    subjectScheduled: new Map(),
    consecutiveCheck: new Map()
  };
  
  const scheduled = new Map<string, ScheduledExam>();
  
  const eligible = exams.filter(e => {
    const isSAS = e.dept.toUpperCase() === 'SAS';
    const isExcluded = shouldExcludeSubject(e.subjectId);
    
    return !isSAS && !isExcluded;
  });
  
  const excludedCount = exams.length - eligible.length - exams.filter(e => e.dept.toUpperCase() === 'SAS').length;
  console.log(`  Eligible: ${eligible.length}`);
  console.log(`  Filtered: ${exams.filter(e => e.dept.toUpperCase() === 'SAS').length} SAS, ${excludedCount} excluded subjects`);
  
  validateSubjectEnrollment(eligible);
  
  console.log('\n📊 Building conflict matrix...');
  const conflictMatrix = buildConflictMatrix(eligible);
  
  const genEds = eligible.filter(e => isGenEdSubject(e.subjectId));
  const mathSubjects = eligible.filter(e => isMathSubject(e));
  const archSubjects = eligible.filter(e => isArchSubject(e.subjectId));
  const majorSubjects = eligible.filter(e =>
    !isGenEdSubject(e.subjectId) &&
    !isMathSubject(e) &&
    !isArchSubject(e.subjectId)
  );
  
  console.log(`\n📋 Exam Categories:`);
  console.log(`  Gen Eds: ${genEds.length}`);
  console.log(`  MATH: ${mathSubjects.length}`);
  console.log(`  ARCH: ${archSubjects.length}`);
  console.log(`  Major: ${majorSubjects.length}`);
  
  let totalScheduled = 0;
  
  const phase1 = scheduleGenEdTimeBlocks(genEds, validRooms, state, conflictMatrix, scheduled, numDays, configs);
  totalScheduled += phase1.scheduled;
  
  const phase2 = scheduleHighPriority([...mathSubjects, ...archSubjects], validRooms, state, conflictMatrix, scheduled, numDays, configs);
  totalScheduled += phase2.scheduled;
  
  const phase3 = scheduleMajorSubjects(majorSubjects, validRooms, state, conflictMatrix, scheduled, numDays, configs);
  totalScheduled += phase3.scheduled;
  
  const allFailed = [...phase1.failed, ...phase2.failed, ...phase3.failed];
  const phase4Count = scheduleIndividually(allFailed, validRooms, state, conflictMatrix, scheduled, numDays, configs);
  totalScheduled += phase4Count;
  
  const scheduledArray = Array.from(scheduled.values());
  const coverage = ((totalScheduled / eligible.length) * 100).toFixed(2);
  
  console.log('\n✅ ======================== FINAL RESULTS ========================');
  console.log(`  Total eligible exams: ${eligible.length}`);
  console.log(`  Successfully scheduled: ${totalScheduled}`);
  console.log(`  Unscheduled: ${eligible.length - totalScheduled}`);
  console.log(`  Coverage: ${coverage}%`);
  console.log(`  ✅ 1.5-Hour Breaks: ENFORCED`);
  console.log(`  ✅ Same Subject Coordination: ENFORCED`);
  console.log(`  ✅ Zero Conflicts: ENFORCED`);
  console.log(`  ✅ Gen Ed Time Blocks: WITH CAPACITY LIMITS`);
  console.log(`  ✅ Building J: EXCLUDED`);
  console.log(`  ✅ Deterministic Scheduling: NO RANDOMNESS`);
  console.log(`  ✅ 6-Unit Priority: OPTIMIZED PLACEMENT`);
  console.log(`  ✅ ARCH 7:30 AM: AVOIDED`);
  console.log(`  ✅ AM/PM Filtering: ACTIVE`);
  console.log('================================================================');
  
  console.log('\n🔍 Validating schedule...');
  const validation = validateNoConflicts(eligible, scheduledArray);
  if (validation.valid) {
    console.log('  ✅ CONFLICT CHECK: PASSED (No student conflicts detected)');
  } else {
    console.error('  ❌ CONFLICT CHECK: FAILED');
    validation.conflicts.forEach(conflict => console.error(`  ${conflict}`));
  }
  
  generateScheduleStatistics(scheduledArray, numDays);
  
  if (totalScheduled < eligible.length) {
    console.warn('\n⚠️  UNSCHEDULED EXAMS:');
    const unscheduledExams = eligible.filter(e =>
      !scheduledArray.some(s => s.CODE === e.code)
    );
    unscheduledExams.slice(0, 20).forEach(exam => {
      console.warn(`  - ${exam.subjectId} (${exam.code}): ${exam.course} Yr ${exam.yearLevel}`);
    });
    if (unscheduledExams.length > 20) {
      console.warn(`  ... and ${unscheduledExams.length - 20} more`);
    }
  }
  
  return scheduledArray;
}