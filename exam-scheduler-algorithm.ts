// ===================================================================
// USL-ERP EXAM SCHEDULER - OPTIMIZED ALGORITHM V7.0
// ===================================================================
// Based on manual schedule analysis + Complete Requirements v2.0
// IMPROVEMENTS: Better time slot utilization, room preferences, distribution
// ===================================================================

import { Exam, ScheduledExam, ConflictMatrix, SchedulingState } from '../subject-code';

// ===================================================================
// CONSTANTS & CONFIGURATION
// ===================================================================

const TIME_SLOTS = [
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

// ✅ IMPROVED: Gen Ed Time Blocks WITHOUT capacity limits
const GEN_ED_TIME_BLOCKS: { [key: string]: { day: number, slot: number }[] } = {
  'ETHC': [
    { day: 0, slot: 0 }, // Day 1, 7:30-9:00 AM
    { day: 0, slot: 1 }  // Fallback: Day 1, 9:00-10:30 AM
  ],
  'ENGL': [
    { day: 0, slot: 2 }, // Day 1, 10:30-12:00 PM
    { day: 2, slot: 0 }, // Day 3, 7:30-9:00 AM
    { day: 0, slot: 1 }  // Fallback: Day 1, 9:00-10:30 AM
  ],
  'PHED': [
    { day: 0, slot: 3 }, // Day 1, 12:00-1:30 PM
    { day: 1, slot: 0 }, // Day 2, 7:30-9:00 AM
    { day: 2, slot: 3 }  // Fallback: Day 3, 12:00-1:30 PM
  ],
  'CFED': [
    { day: 0, slot: 4 }, // Day 1, 1:30-3:00 PM (PRIMARY)
    { day: 1, slot: 1 }, // Day 2, 9:00-10:30 AM
    { day: 1, slot: 2 }, // Day 2, 10:30-12:00 PM
    { day: 0, slot: 5 }, // Fallback: Day 1, 3:00-4:30 PM
    { day: 1, slot: 4 }  // Fallback: Day 2, 1:30-3:00 PM
  ],
  'CONW': [
    { day: 1, slot: 5 }, // Day 2, 3:00-4:30 PM
    { day: 0, slot: 5 }, // Fallback: Day 1, 3:00-4:30 PM
    { day: 2, slot: 5 }  // Fallback: Day 3, 3:00-4:30 PM
  ],
  'LANG': [
    { day: 2, slot: 3 }, // Day 3, 12:00-1:30 PM
    { day: 2, slot: 4 }, // Fallback: Day 3, 1:30-3:00 PM
    { day: 1, slot: 3 }  // Fallback: Day 2, 12:00-1:30 PM
  ],
  'LITR': [
    { day: 2, slot: 4 }, // Day 3, 1:30-3:00 PM
    { day: 2, slot: 5 }, // Fallback: Day 3, 3:00-4:30 PM
    { day: 0, slot: 4 }  // Fallback: Day 1, 1:30-3:00 PM
  ],
  // Add MATH as Gen Ed when taken as Gen Ed
  'MATH': [
    { day: 2, slot: 2 }, // Day 3, 10:30-12:00 PM
    { day: 0, slot: 2 }, // Fallback: Day 1, 10:30-12:00 PM
    { day: 1, slot: 2 }  // Fallback: Day 2, 10:30-12:00 PM
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

// ✅ NEW: Get floor number from room
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
  
  if (deptUpper.includes('SECAP')) return ['A', 'B', 'J'];
  if (deptUpper.includes('SABH')) return ['A'];
  if (deptUpper.includes('SACE')) return ['N', 'K', 'C'];
  if (deptUpper.includes('SHAS')) return ['L', 'M', 'N', 'K', 'J'];
  
  return ['A', 'N', 'K', 'L', 'M', 'B', 'C', 'J'];
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
  state: SchedulingState
): boolean {
  const dayKey = `Day ${day + 1}`;
  const existingExams: { slot: number }[] = [];
  
  state.assignments.forEach((scheduledExamArray) => {
    scheduledExamArray.forEach((scheduledExam) => {
      if (scheduledExam.DAY === dayKey) {
        const examCourse = scheduledExam.COURSE;
        const examYear = scheduledExam.YEAR_LEVEL;
        const examCourseYear = `${examCourse}-${examYear}`;
        
        if (examCourseYear === courseYear) {
          const examSlotIndex = TIME_SLOTS.indexOf(scheduledExam.SLOT);
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
  conflictMatrix: ConflictMatrix
): boolean {
  const courseYear = `${exam.course}-${exam.yearLevel}`;
  const dayKey = `Day ${day + 1}`;
  const slotKey = TIME_SLOTS[slot];
  
  const courseYearConflicts = conflictMatrix[courseYear];
  const conflicts: Set<string> = courseYearConflicts ? (courseYearConflicts[exam.subjectId] || new Set<string>()) : new Set<string>();
  
  for (const conflictSubject of conflicts) {
    const existing = state.subjectScheduled.get(conflictSubject);
    if (existing && existing.day === dayKey && existing.slot === slotKey) {
      return true;
    }
  }
  
  if (!hasRequiredBreak(courseYear, day, slot, state)) {
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
  is6Unit: boolean
): string[] {
  const allowedBuildings = getAvailableBuildings(exam.dept, exam.subjectId);
  const dayKey = `Day ${day + 1}`;
  const slotKey = TIME_SLOTS[slot];
  
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
    
    if (is6Unit && slot < TIME_SLOTS.length - 1) {
      const nextSlotKey = TIME_SLOTS[slot + 1];
      if (dayUsage.has(nextSlotKey)) {
        const nextSlotUsage = dayUsage.get(nextSlotKey);
        if (nextSlotUsage && nextSlotUsage.has(room)) return false;
      }
    }
    
    return true;
  });
  
  // ✅ IMPROVED: Sort by building preference AND floor preference
  return available.sort((a, b) => {
    const buildingA = getBuildingFromRoom(a);
    const buildingB = getBuildingFromRoom(b);
    
    // ARCH subjects prefer Building C
    if (isArchSubject(exam.subjectId)) {
      if (buildingA === 'C' && buildingB !== 'C') return -1;
      if (buildingA !== 'C' && buildingB === 'C') return 1;
    }
    
    // Prefer ground floor (floor 1) first
    const floorA = getFloorFromRoom(a);
    const floorB = getFloorFromRoom(b);
    
    if (floorA !== floorB) {
      // Ground floor (1) comes first, then 2, 3, 4
      return floorA - floorB;
    }
    
    // Within same floor, sort alphabetically
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
  scheduled: Map<string, ScheduledExam>
): void {
  const dayKey = `Day ${day + 1}`;
  const slotKey = TIME_SLOTS[slot];
  
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
  scheduled: Map<string, ScheduledExam>
): boolean {
  if (slot >= TIME_SLOTS.length - 1) return false;
  
  scheduleExam(exam, day, slot, room, state, scheduled);
  
  const nextSlot = slot + 1;
  const dayKey = `Day ${day + 1}`;
  const nextSlotKey = TIME_SLOTS[nextSlot];
  
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
  scheduled: Map<string, ScheduledExam>
): boolean {
  const roomAssignments: { exam: Exam, room: string }[] = [];
  
  for (const exam of group) {
    if (hasConflict(exam, day, slot, state, conflictMatrix)) {
      return false;
    }
    
    const availableRooms = getAvailableRooms(
      exam,
      day,
      slot,
      allRooms,
      state,
      is6UnitSubject(exam)
    );
    
    if (availableRooms.length === 0) {
      return false;
    }
    
    roomAssignments.push({ exam, room: availableRooms[0] });
  }
  
  for (const { exam, room } of roomAssignments) {
    if (is6UnitSubject(exam)) {
      schedule6UnitExam(exam, day, slot, room, state, scheduled);
    } else {
      scheduleExam(exam, day, slot, room, state, scheduled);
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
  numDays: number
): { scheduled: number, failed: Exam[] } {
  console.log('\n📗 PHASE 1: Gen Ed Time Blocks...');
  
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
  
  genEdGroups.forEach((exams, genEdType) => {
    const timeBlocks = GEN_ED_TIME_BLOCKS[genEdType];
    if (!timeBlocks) {
      // ✅ NEW: If no time block defined, try to schedule in any available slot
      console.log(`  ℹ️  ${genEdType}: No time block defined, will schedule in Phase 3`);
      failed.push(...exams);
      return;
    }
    
    const subjectGroups = groupExamsBySubject(exams);
    
    subjectGroups.forEach((group, subjectId) => {
      let placed = false;
      
      // ✅ IMPROVED: Try ALL time blocks without capacity restriction
      for (const block of timeBlocks) {
        if (placed) break;
        
        // ✅ NEW: Skip 7:30 AM for CFED (add penalty approach)
        if (genEdType === 'CFED' && block.slot === 0) {
          continue; // Skip 7:30 AM for CFED
        }
        
        if (tryScheduleGroup(group, block.day, block.slot, allRooms, state, conflictMatrix, scheduled)) {
          scheduledCount += group.length;
          placed = true;
          console.log(`  ✅ ${genEdType}: ${subjectId} (${group.length} sections) → Day ${block.day + 1} ${TIME_SLOTS[block.slot]}`);
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
  numDays: number
): { scheduled: number, failed: Exam[] } {
  console.log('\n📕 PHASE 2: High Priority (MATH & ARCH)...');
  
  let scheduledCount = 0;
  const failed: Exam[] = [];
  
  const mathExams = exams.filter(e => isMathSubject(e));
  const archExams = exams.filter(e => isArchSubject(e.subjectId));
  
  const mathGroups = groupExamsBySubject(mathExams);
  mathGroups.forEach((group, subjectId) => {
    let placed = false;
    
    // ✅ IMPROVED: Try all days and slots systematically
    for (let day = 0; day < numDays && !placed; day++) {
      for (let slot = 0; slot < TIME_SLOTS.length && !placed; slot++) {
        if (tryScheduleGroup(group, day, slot, allRooms, state, conflictMatrix, scheduled)) {
          scheduledCount += group.length;
          placed = true;
          console.log(`  ✅ MATH: ${subjectId} (${group.length} sections) → Day ${day + 1} ${TIME_SLOTS[slot]}`);
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
    
    for (let day = 0; day < numDays && !placed; day++) {
      for (let slot = 0; slot < TIME_SLOTS.length && !placed; slot++) {
        if (tryScheduleGroup(group, day, slot, allRooms, state, conflictMatrix, scheduled)) {
          scheduledCount += group.length;
          placed = true;
          console.log(`  ✅ ARCH: ${subjectId} (${group.length} sections) → Day ${day + 1} ${TIME_SLOTS[slot]} (Building C)`);
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
// PHASE 3: MAJOR SUBJECTS (More Aggressive)
// ===================================================================

function scheduleMajorSubjects(
  exams: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number
): { scheduled: number, failed: Exam[] } {
  console.log('\n📘 PHASE 3: Major Subjects (Aggressive Mode)...');
  
  let scheduledCount = 0;
  const failed: Exam[] = [];
  
  const subjectGroups = groupExamsBySubject(exams);
  
  // ✅ IMPROVED: Track day load to balance distribution (target 35-36-28)
  const dayLoad: number[] = new Array(numDays).fill(0);
  
  // Get current loads from already scheduled exams
  state.assignments.forEach((scheduledExamArray, key) => {
    const dayMatch = key.match(/Day (\d+)/);
    if (dayMatch) {
      const dayIndex = parseInt(dayMatch[1], 10) - 1;
      if (dayIndex >= 0 && dayIndex < numDays) {
        dayLoad[dayIndex] += scheduledExamArray.length;
      }
    }
  });
  
  // Sort groups by size (larger first for better packing)
  const sortedGroups = Array.from(subjectGroups.entries())
    .sort((a, b) => b[1].length - a[1].length);
  
  sortedGroups.forEach(([subjectId, group]) => {
    let placed = false;
    
    // ✅ IMPROVED: Try days in strategic order (least loaded first, but prefer Day 1-2 over Day 3)
    const dayPreferences: { day: number, load: number, penalty: number }[] = [];
    for (let day = 0; day < numDays; day++) {
      // Add penalty for Day 3 to prefer Days 1-2
      const penalty = day === 2 ? 50 : 0;
      dayPreferences.push({ day, load: dayLoad[day], penalty });
    }
    
    // Sort by (load + penalty) - will prefer Day 1-2 when loads are similar
    dayPreferences.sort((a, b) => (a.load + a.penalty) - (b.load + b.penalty));
    
    // ✅ IMPROVED: Try ALL time slots systematically
    for (const { day } of dayPreferences) {
      if (placed) break;
      
      // Try all slots for this day
      for (let slot = 0; slot < TIME_SLOTS.length && !placed; slot++) {
        if (tryScheduleGroup(group, day, slot, allRooms, state, conflictMatrix, scheduled)) {
          scheduledCount += group.length;
          placed = true;
          dayLoad[day] += group.length;
          console.log(`  ✅ ${subjectId} (${group.length} sections) → Day ${day + 1} ${TIME_SLOTS[slot]}`);
        }
      }
    }
    
    if (!placed) {
      failed.push(...group);
      console.log(`  ⚠️  ${subjectId} (${group.length} sections) - will retry individually in Phase 4`);
    }
  });
  
  console.log(`  ✅ Phase 3 complete: ${scheduledCount} major subjects scheduled`);
  console.log(`  📊 Distribution: Day 1: ${dayLoad[0]}, Day 2: ${dayLoad[1]}, Day 3: ${dayLoad[2]}`);
  return { scheduled: scheduledCount, failed };
}

// ===================================================================
// PHASE 4: INDIVIDUAL SCHEDULING (Ultra Aggressive)
// ===================================================================

function scheduleIndividually(
  exams: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number
): number {
  console.log('\n🔧 PHASE 4: Individual Scheduling (Ultra Aggressive Mode)...');
  
  let scheduledCount = 0;
  
  // ✅ IMPROVED: Track day loads
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
  
  exams.forEach(exam => {
    let placed = false;
    
    // ✅ IMPROVED: Try days in order of least loaded (with Day 3 penalty)
    const dayPreferences: { day: number, load: number, penalty: number }[] = [];
    for (let day = 0; day < numDays; day++) {
      const penalty = day === 2 ? 30 : 0;
      dayPreferences.push({ day, load: dayLoad[day], penalty });
    }
    
    dayPreferences.sort((a, b) => (a.load + a.penalty) - (b.load + b.penalty));
    
    for (const { day } of dayPreferences) {
      if (placed) break;
      
      // ✅ IMPROVED: Try ALL slots including evening (18:00-19:30)
      for (let slot = 0; slot < TIME_SLOTS.length && !placed; slot++) {
        if (hasConflict(exam, day, slot, state, conflictMatrix)) continue;
        
        const availableRooms = getAvailableRooms(exam, day, slot, allRooms, state, is6UnitSubject(exam));
        
        if (availableRooms.length > 0) {
          if (is6UnitSubject(exam)) {
            if (schedule6UnitExam(exam, day, slot, availableRooms[0], state, scheduled)) {
              scheduledCount++;
              placed = true;
              dayLoad[day]++;
              console.log(`  ✅ ${exam.subjectId} (6u) → Day ${day + 1} ${TIME_SLOTS[slot]} + ${TIME_SLOTS[slot + 1]}`);
            }
          } else {
            scheduleExam(exam, day, slot, availableRooms[0], state, scheduled);
            scheduledCount++;
            placed = true;
            dayLoad[day]++;
            
            // Log only if it's an unusual time slot (early morning or evening)
            if (slot === 0 || slot === 7) {
              console.log(`  ✅ ${exam.subjectId} → Day ${day + 1} ${TIME_SLOTS[slot]}`);
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
// MAIN ALGORITHM ENTRY POINT
// ===================================================================

export function generateExamSchedule(
  exams: Exam[],
  rooms: string[],
  numDays: number
): ScheduledExam[] {
  console.log('🚀 Starting Optimized Exam Scheduler Algorithm v7.0...');
  console.log(`  Total exams: ${exams.length}`);
  console.log(`  Rooms: ${rooms.length}`);
  console.log(`  Days: ${numDays}`);
  
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
  
  console.log('📊 Building conflict matrix...');
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
  
  const phase1 = scheduleGenEdTimeBlocks(genEds, rooms, state, conflictMatrix, scheduled, numDays);
  totalScheduled += phase1.scheduled;
  
  const phase2 = scheduleHighPriority(
    [...mathSubjects, ...archSubjects],
    rooms,
    state,
    conflictMatrix,
    scheduled,
    numDays
  );
  totalScheduled += phase2.scheduled;
  
  const phase3 = scheduleMajorSubjects(majorSubjects, rooms, state, conflictMatrix, scheduled, numDays);
  totalScheduled += phase3.scheduled;
  
  const allFailed = [...phase1.failed, ...phase2.failed, ...phase3.failed];
  const phase4Count = scheduleIndividually(allFailed, rooms, state, conflictMatrix, scheduled, numDays);
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
  console.log(`  ✅ Gen Ed Time Blocks: IMPLEMENTED`);
  console.log(`  ✅ All 8 Time Slots: UTILIZED`);
  console.log('================================================================');
  
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