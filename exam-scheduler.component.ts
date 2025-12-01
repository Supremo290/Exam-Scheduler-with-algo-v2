import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { ApiService } from '../api.service';
import { GlobalService } from '../global.service';
import { MatDialog } from '@angular/material';
import Swal from 'sweetalert2';
import { SharedDataService } from '../shared-data.service';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { generateExamSchedule as algorithmGenerateSchedule } from './exam-scheduler-algorithm';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { 
  Exam, 
  ScheduledExam, 
  ToastMessage, 
  SafeSlotOption, 
  ExamDay, 
  ExamGroup,
  ConflictMatrix,
  SubjectPriority,
  RoomPreference,
  SchedulingState,
  SlotOption
} from '../subject-code';

@Component({
  selector: 'app-exam-scheduler',
  templateUrl: './exam-scheduler.component.html',
  styleUrls: ['./exam-scheduler.component.scss']
})
export class ExamSchedulerComponent implements OnInit {
  // State management
 currentStep: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' | 'simpleschedule' | 'roomgrid' | 'studentmapping' = 'import';
 isLoadingApi: boolean = false;
  
  // Core data
  rawCodes: any[] = [];
  exams: Exam[] = [];
  rooms: string[] = [];
  roomCapacities: Map<string, number> = new Map();
  roomPreferences: Map<string, RoomPreference> = new Map();
  generatedSchedule: ScheduledExam[] = [];
  subjectTypes: Map<string, 'genEd' | 'major'> = new Map();
  
  // Exam configuration
  examDates: string[] = ['', '', ''];
  days: string[] = ['Day 1', 'Day 2', 'Day 3'];
  activeDay: string = 'Day 1';
  
  // Time slots (1.5 hour intervals)
  timeSlots: string[] = [
  '7:30-9:00', '9:00-10:30', '10:30-12:00', '12:00-13:30',
  '13:30-15:00', '15:00-16:30', '16:30-18:00', '18:00-19:30'
];
  
  // Term selection
  activeTerm: string = '';
  combinedOptions: { label: string, value: string }[] = [];
  termOptions = [
    { key: 1, value: '1st Semester' },
    { key: 2, value: '2nd Semester' },
    { key: 3, value: 'Summer' },
  ];
  
  // UI state
  editingRow: number | null = null;
  editedExam: ScheduledExam | null = null;
  toast: ToastMessage | null = null;
  movePopupVisible = false;
  moveExamData: any = null;
  safeSlots: SafeSlotOption[] = [];
  showExamGroupManager: boolean = false;
  
  // Exam groups
  savedExamGroups: ExamGroup[] = [];
  selectedExamGroup: ExamGroup | null = null;
  
  // View data
  courseSummary: any[] = [];
  roomTimeData: any = { table: {}, rooms: [], days: [] };
  courseGridData: any = { grid: {}, courses: [], days: [] };

  selectedCourse: string = 'ALL';
  selectedYearLevel: string = 'ALL';
  selectedDepartment: string = 'ALL'; 
  selectedDay: string = 'ALL';
  searchTerm: string = ''; 


  private searchSubject = new Subject<string>();
  private filteredScheduleCache: ScheduledExam[] = [];

  constructor(
    public api: ApiService,
    public global: GlobalService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private http: HttpClient,
    private sharedData: SharedDataService,
  ) {}

ngOnInit() {
    // ✅ Ensure we start on the import step
    this.currentStep = 'import';
    
    this.activeDay = this.days[0];
    this.roomTimeData.days = [...this.days];
    this.courseGridData.days = [...this.days];
    this.combineYearTerm();
    
    this.sharedData.clearSelectedExamGroup();
    this.sharedData.clearExamDates();
    this.sharedData.clearActiveTerm();
    this.selectedExamGroup = null;
    
    this.loadSavedExamGroups();
    
    this.sharedData.selectedExamGroup$.subscribe(group => {
      if (group) {
        this.selectedExamGroup = group;
        this.examDates = group.days.map(d => 
          d.date ? new Date(d.date).toLocaleDateString('en-CA') : ''
        );
        this.activeTerm = group.termYear || '';
      }
    });
    
    // ✅ NEW: Setup debounced search
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => {
      this.updateFilteredSchedule();
    });
    
    this.cdr.detectChanges();
  }

  // ===================================================================
  // HELPER METHODS (Required by new algorithm)
  // ===================================================================

  isGenEdSubject(subjectId: string): boolean {
    const upperSubject = subjectId.toUpperCase();
    const genEdPrefixes = ['CFED', 'PHED', 'ENGL', 'CONW', 'LANG', 'JAPN', 'CHIN', 'SPAN', 'LITR', 'ETHC', 'RESM'];
    return genEdPrefixes.some(prefix => upperSubject.startsWith(prefix));
  }

  isMathSubject(exam: Exam): boolean {
    return exam.subjectId.toUpperCase().startsWith('MATH') && exam.dept === 'SACE';
  }

  isArchSubject(subjectId: string): boolean {
    return subjectId.toUpperCase().includes('ARCH');
  }

  extractBuilding(room: string): string {
    if (!room) return '';
    const match = room.match(/^([A-Z]+)-/);
    return match ? match[1] : '';
  }

  generateRoomList(): string[] {
    const rooms: string[] = [];
    
    // BCJ Campus - Building A (47 rooms)
    for (let i = 101; i <= 115; i++) rooms.push(`A-${i}`);
    for (let i = 201; i <= 216; i++) rooms.push(`A-${i}`);
    for (let i = 301; i <= 316; i++) rooms.push(`A-${i}`);
    
    // Main Campus Buildings
    rooms.push('C-21', 'C-22', 'C-23', 'C-24', 'C-25');
    for (let i = 11; i <= 15; i++) rooms.push(`N-${i}`);
    for (let i = 21; i <= 28; i++) rooms.push(`N-${i}`);
    for (let i = 31; i <= 40; i++) rooms.push(`N-${i}`);
    for (let i = 11; i <= 13; i++) rooms.push(`K-${i}`);
    for (let i = 21; i <= 25; i++) rooms.push(`K-${i}`);
    for (let i = 31; i <= 35; i++) rooms.push(`K-${i}`);
    rooms.push('J-11', 'J-12', 'J-21', 'J-22', 'J-31', 'J-32');
    rooms.push('B-11', 'B-21');
    
    // Lecaros Campus
    for (let i = 11; i <= 15; i++) rooms.push(`L-${i}`);
    for (let i = 21; i <= 24; i++) rooms.push(`L-${i}`);
    for (let i = 11; i <= 14; i++) rooms.push(`M-${i}`);
    rooms.push('M-21', 'M-22', 'M-23');
    
    return rooms;
  }

  // ===================================================================
  // INITIALIZATION METHODS
  // ===================================================================
  
  combineYearTerm() {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 1; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of this.termOptions) {
        const label = `${t.value} SY ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.combinedOptions.push({ label, value });
      }
    }
  }

  loadSavedExamGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }

  // ===================================================================
  // EXAM GROUP MANAGEMENT
  // ===================================================================
  
  toggleExamGroupManager() {
    this.showExamGroupManager = !this.showExamGroupManager;
  }

selectExamGroup(group: ExamGroup) {
  console.log('🔵 selectExamGroup called for:', group.name);
  
  this.selectedExamGroup = group;
  this.activeTerm = group.termYear || '';
  
  this.examDates = group.days
    .map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '')
    .filter(d => d !== '');
  
  this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
  
  this.sharedData.setSelectedExamGroup(group);
  this.sharedData.setExamDates(group.days);
  if (group.termYear) this.sharedData.setActiveTerm(group.termYear);
  
  const scheduleExists = this.hasScheduleForGroup(group.name, group.termYear || '');
  console.log('📋 Schedule exists?', scheduleExists);
  
  if (scheduleExists) {
    console.log('✅ Showing dialog to load saved schedule');
    
    // ✅ ANGULAR 8 COMPATIBLE: Use type and .then()
    Swal.fire({
      title: 'Saved Schedule Found!',
      text: 'This exam group already has a generated schedule. Would you like to load it?',
      type: 'question',  // ✅ Angular 8 uses 'type' not 'icon'
      showCancelButton: true,
      confirmButtonText: '📋 Load Saved Schedule',
      cancelButtonText: '✖ Cancel',
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#6b7280'
    }).then((result) => {  // ✅ Use .then() for Angular 8
      console.log('📘 Dialog result:', result);
      
      // ✅ ANGULAR 8 COMPATIBLE: Check result.value
      if (result.value) {
        console.log('✅ User clicked Load Saved Schedule');
        
        if (this.loadScheduleForGroup(group.name, group.termYear || '')) {
          console.log('✅ Schedule loaded successfully');
          
          // Prepare data
          this.generateSimpleScheduleData();
          
          // Reset filters
          this.selectedCourse = 'ALL';
          this.selectedYearLevel = 'ALL';
          this.selectedDepartment = 'ALL';
          this.selectedDay = 'ALL';
          this.searchTerm = '';
          
          // ✅ Use setTimeout for safer navigation
          setTimeout(() => {
            this.currentStep = 'simpleschedule';
            this.cdr.detectChanges();
            
            console.log('✅ Navigation complete. Current step:', this.currentStep);
          }, 100);
          
          this.showToast('Success', `Loaded saved schedule for "${group.name}"`);
        } else {
          console.error('❌ Failed to load schedule');
          this.showToast('Error', 'Failed to load saved schedule');
        }
      } else {
        console.log('❌ User clicked Cancel');
        this.showToast('Success', `Selected "${group.name}" - Ready to load API data`);
      }
    });
  } else {
    console.log('ℹ️ No saved schedule found - just selecting group');
    this.showToast('Success', `Selected "${group.name}" with ${this.examDates.length} exam days`);
  }
  
  this.showExamGroupManager = false;
}

editGroup(group: ExamGroup) {
  const originalData = {
    name: group.name,
    termYear: group.termYear,
    daysCount: group.days.length,
    days: JSON.stringify(group.days)
  };
  
  const dialogRef = this.dialog.open(DatePickerComponent, {
    width: '800px',
    maxHeight: '90vh',
    data: { group, mode: 'edit' }
  });

  dialogRef.afterClosed().subscribe((result) => {
    this.loadSavedExamGroups();
    
    if (result && result.success) {
      const updatedGroup = result.group;
      const datesChanged = 
        originalData.daysCount !== updatedGroup.days.length ||
        originalData.days !== JSON.stringify(updatedGroup.days);
      
      const hasSchedule = this.hasScheduleForGroup(updatedGroup.name, updatedGroup.termYear || '');
      
      if (hasSchedule && datesChanged) {
        // ✅ ANGULAR 8 COMPATIBLE
        Swal.fire({
          title: 'Schedule Needs Update',
          text: `You changed the exam dates for "${updatedGroup.name}". The existing schedule is now outdated. Would you like to regenerate the schedule now?`,
          type: 'question',  // ✅ Angular 8 uses 'type'
          showCancelButton: true,
          confirmButtonText: '🔄 Regenerate Now',
          cancelButtonText: '📋 Keep Old Schedule',
          confirmButtonColor: '#10b981',
          cancelButtonColor: '#6b7280'
        }).then((choice) => {  // ✅ Use .then()
          if (choice.value) {  // ✅ Check choice.value
            this.regenerateScheduleForGroup(updatedGroup);
          } else {
            this.updateScheduleDateMappings(updatedGroup);
            this.showToast('Success', `Schedule kept for "${updatedGroup.name}" with updated dates!`, 'success');
          }
        });
      } else {
        this.showToast('Success', `Updated "${updatedGroup.name}" successfully`);
      }
      
      if (this.selectedExamGroup && this.selectedExamGroup.name === group.name) {
        const reloadedGroup = this.savedExamGroups.find(g => g.name === updatedGroup.name);
        if (reloadedGroup) {
          this.selectedExamGroup = reloadedGroup;
          this.activeTerm = reloadedGroup.termYear || '';
          this.examDates = reloadedGroup.days
            .map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '')
            .filter(d => d !== '');
          this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
          this.activeDay = this.days[0] || 'Day 1';
          
          this.sharedData.setSelectedExamGroup(reloadedGroup);
          this.sharedData.setExamDates(reloadedGroup.days);
          if (reloadedGroup.termYear) this.sharedData.setActiveTerm(reloadedGroup.termYear);
        }
      }
    }
    
    this.cdr.detectChanges();
  });
}

deleteGroup(groupName: string) {
  // ✅ ANGULAR 8 COMPATIBLE: Use native confirm for simple cases
  const confirmDelete = confirm(`Delete exam group "${groupName}"? This will also delete any saved schedules.`);
  
  if (confirmDelete) {
    const groupToDelete = this.savedExamGroups.find(g => g.name === groupName);
    const currentlySelected = this.sharedData.getSelectedExamGroup();
    const isSelectedGroup = currentlySelected && currentlySelected.name === groupName;

    this.savedExamGroups = this.savedExamGroups.filter(g => g.name !== groupName);
    localStorage.setItem('examGroups', JSON.stringify(this.savedExamGroups));
    
    if (groupToDelete && groupToDelete.termYear) {
      const scheduleKey = `schedule_${groupName}_${groupToDelete.termYear}`;
      localStorage.removeItem(scheduleKey);
    }
    
    this.loadSavedExamGroups();

    if (isSelectedGroup) {
      this.sharedData.clearExamDates();
      this.sharedData.clearSelectedExamGroup();
      this.sharedData.clearActiveTerm();
      
      if (groupToDelete && groupToDelete.termYear) {
        this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
      }
      
      this.sharedData.clearStudentMapping();
      this.selectedExamGroup = null;
      this.examDates = ['', '', ''];
      this.activeTerm = '';
      
      this.global.swalSuccess(`Deleted "${groupName}". All associated data has been cleared.`);
    } else {
      if (groupToDelete && groupToDelete.termYear) {
        this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
      }
      this.global.swalSuccess(`Deleted "${groupName}".`);
    }
  }
}

  // ===================================================================
  // DATA LOADING
  // ===================================================================
  
async loadExamData() {
  if (!this.activeTerm) {
    this.showToast('Error', 'Please select a term first', 'destructive');
    return false;
  }

  this.isLoadingApi = true;

  try {
    console.log('🔍 DEBUG: Requesting exams for term:', this.activeTerm);
    
    const response: any = await this.api.getCodeSummaryReport(this.activeTerm).toPromise();
    
    let parsed;
    if (response && typeof response.json === 'function') {
      parsed = response.json();
    } else {
      parsed = response;
    }

    console.log('📥 Parsed API response:', parsed);

    let data;
    if (parsed && parsed.data && Array.isArray(parsed.data)) {
      data = parsed.data;
    } else if (Array.isArray(parsed)) {
      data = parsed;
    } else {
      console.error('❌ Unexpected API response structure:', parsed);
      throw new Error('API response is not in expected format');
    }

    console.log('✅ API returned', data.length, 'exam records');

    if (data.length === 0) {
      console.error('❌ API returned ZERO records!');
      this.showToast('Error', 'No exam data found for this term', 'destructive');
      return false;
    }

    if (data.length > 0) {
      console.log('🔍 First API item:', data[0]);
      console.log('🔍 Available fields:', Object.keys(data[0]));
    }

    this.rawCodes = data;

    // ✅ IMPROVED: Multiple fallback field names for Angular 8 compatibility
    this.exams = data
      .filter((item: any) => {
        const deptCode = (item.deptCode || item.dept || item.DEPT_CODE || item.DEPT || '').toUpperCase();
        return deptCode !== 'SAS';
      })
      .map((item: any) => {
        // Try multiple field name variations
        const subjectId = item.subjectId || item.SUBJECT_ID || item.subject_id || '';
        const title = item.subjectTitle || item.descriptiveTitle || item.SUBJECT_TITLE || item.DESCRIPTIVE_TITLE || item.title || '';
        const code = item.codeNo || item.CODE_NO || item.code || item.CODE || '';
        const course = (item.course || item.COURSE || '').trim();
        const yearLevel = parseInt(item.yearLevel || item.year || item.YEAR_LEVEL || item.YEAR || '1', 10);
        const dept = (item.deptCode || item.dept || item.DEPT_CODE || item.DEPT || '').toUpperCase();
        const instructor = item.instructor || item.INSTRUCTOR || 'TBA';
        const lecUnits = parseInt(item.lecUnits || item.lec || item.LEC_UNITS || item.LEC || '3', 10);
        const oe = parseInt(item.oe || item.OE || '0', 10);
        const studentCount = parseInt(item.classSize || item.studentCount || item.CLASS_SIZE || item.STUDENT_COUNT || '0', 10);
        const campus = item.roomCampusLocation || item.campus || item.CAMPUS || 'MAIN';
        const roomNumber = item.roomNumber || item.ROOM_NUMBER || item.room || '';
        
        return {
          code: code,
          version: item.version || '1',
          subjectId: subjectId,
          title: title,
          course: course,
          yearLevel: yearLevel,
          lec: lecUnits,
          oe: oe,
          dept: dept,
          instructor: instructor,
          studentCount: studentCount,
          isRegular: true,
          campus: campus,
          lectureRoom: roomNumber,
          lectureBuilding: this.extractBuilding(roomNumber)
        };
      })
      .filter((exam: Exam) => {
        if (!exam.subjectId || !exam.course) {
          console.warn('⚠️ Filtered out exam with missing fields:', exam);
          return false;
        }
        return true;
      });

    this.rooms = this.generateRoomList();

    console.log('✅ Processed', this.exams.length, 'exams');
    console.log('✅ Generated', this.rooms.length, 'rooms');

    if (this.exams.length === 0) {
      console.error('❌ No exams were successfully processed!');
      this.showToast('Error', 'No valid exams after processing', 'destructive');
      return false;
    }

    console.log('🔍 Sample of first 3 processed exams:');
    this.exams.slice(0, 3).forEach((exam, idx) => {
      console.log(`  ${idx + 1}.`, exam);
    });

    return true;

  } catch (error) {
    console.error('❌ Error loading exam data:', error);
    const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
    this.showToast('Error', `Failed to load exam data: ${errorMessage}`, 'destructive');
    return false;
  } finally {
    this.isLoadingApi = false;
  }
}

  getUniqueRooms(data: any[]): string[] {
    if (!data || data.length === 0) return [];

    const roomSet = new Set<string>();
    
    const allowedPrefixes = ['A-', 'N-', 'K-', 'C-', 'L-', 'M-'];
    
    const excludedRooms = [
      'A-102','A-203','A-204','A-205','A-219','A-221','A-225','A-226','A-234',
      'A-302','A-306','A-308','A-309','A-310','A-311','A-312',
      'K-13','K-14','K-22','K-24','K-41',
      'L-23','M-21','M-31','M-33','M-43',
      'DemoR','Pharm', 'TBA', 'Virtu', 'EMC', 'Field', 'Hosp', 'Molec',
      'BTL','BUL','HL','SMTL','MChem','MLab1','MLab2','Nutri',
      '', 'null', 'undefined', 'N/A', 'NA'
    ];
    
    data.forEach((item) => {
      const room = item.roomNumber || item.ROOM_NUMBER || item.ROOM || 
                   item.room || item.roomNo || item.ROOM_NO || '';
      
      if (room) {
        const trimmedRoom = room.toString().trim();
        
        const hasAllowedPrefix = allowedPrefixes.some(prefix => 
          trimmedRoom.startsWith(prefix)
        );
        
        if (trimmedRoom && 
            trimmedRoom.length > 0 && 
            hasAllowedPrefix &&
            !excludedRooms.includes(trimmedRoom) &&
            trimmedRoom.toLowerCase() !== 'tba') {
          roomSet.add(trimmedRoom);
        }
      }
    });
    
    return Array.from(roomSet).sort((a, b) => {
      const aMatch = a.match(/\d+/);
      const bMatch = b.match(/\d+/);
      const aNum = parseInt(aMatch ? aMatch[0] : '0');
      const bNum = parseInt(bMatch ? bMatch[0] : '0');
      return aNum - bNum;
    });
  }

  extractRoomCapacities(data: any[]) {
    this.roomCapacities.clear();
    
    if (!data || data.length === 0) return;
    
    data.forEach(item => {
      const room = item.roomNumber || item.ROOM_NUMBER || item.ROOM || item.room || '';
      const capacityValue = item.classSize || item.CLASS_SIZE || item.capacity || item.CAPACITY || '';
      
      if (room && capacityValue) {
        const trimmedRoom = room.toString().trim();
        const capacity = parseInt(capacityValue) || 0;
        
        if (trimmedRoom && capacity > 0) {
          const currentCapacity = this.roomCapacities.get(trimmedRoom);
          if (!currentCapacity || currentCapacity < capacity) {
            this.roomCapacities.set(trimmedRoom, capacity);
          }
        }
      }
    });
  }

  buildRoomPreferences() {
    this.roomPreferences.clear();
    
    this.rooms.forEach(room => {
      const building = room.charAt(0).toUpperCase();
      const roomMatch = room.match(/\d+/);
      const roomNum = parseInt(roomMatch ? roomMatch[0] : '0');
      const floor = Math.floor(roomNum / 100) || 0;
      const isGroundFloor = floor === 1;
      
      let campus: 'BCJ' | 'MAIN' | 'LECAROS' = 'MAIN';
      let deptPref: string[] = [];
      
      if (building === 'A') {
        campus = 'BCJ';
        deptPref = ['SABH', 'SECAP'];
      }
      else if (['N', 'K', 'C'].includes(building)) {
        campus = 'MAIN';
        
        if (building === 'C') {
          deptPref = ['SACE'];
        }
        else if (['N', 'K'].includes(building)) {
          deptPref = ['SACE', 'SHAS'];
        }
      }
      else if (['L', 'M'].includes(building)) {
        campus = 'LECAROS';
        deptPref = ['SHAS'];
      }
      
      const type: 'lecture' | 'lab' = 'lecture';
      
      this.roomPreferences.set(room, {
        room,
        campus,
        building,
        floor,
        capacity: this.roomCapacities.get(room) || 40,
        type,
        deptPreference: deptPref,
        isGroundFloor
      });
    });
    
    console.log('🏢 Room Distribution by Campus:');
    console.log('BCJ:', this.rooms.filter(r => r.startsWith('A-')).length);
    console.log('MAIN:', this.rooms.filter(r => ['N-', 'K-', 'C-'].some(p => r.startsWith(p))).length);
    console.log('LECAROS:', this.rooms.filter(r => ['L-', 'M-'].some(p => r.startsWith(p))).length);
  }

  getRoomsByCampus(): { BCJ: string[], MAIN: string[], LECAROS: string[] } {
    const result = { 
      BCJ: [] as string[], 
      MAIN: [] as string[], 
      LECAROS: [] as string[] 
    };
    
    this.roomPreferences.forEach((pref, room) => {
      if (pref.campus === 'BCJ') result.BCJ.push(room);
      else if (pref.campus === 'MAIN') result.MAIN.push(room);
      else if (pref.campus === 'LECAROS') result.LECAROS.push(room);
    });
    
    return result;
  }

  categorizeSubjects() {
    this.subjectTypes.clear();
    const subjectCourseCount = new Map<string, Set<string>>();
    
    this.exams.forEach(exam => {
      if (!subjectCourseCount.has(exam.subjectId)) {
        subjectCourseCount.set(exam.subjectId, new Set());
      }
      subjectCourseCount.get(exam.subjectId)!.add(exam.course);
    });
    
    // Enhanced Gen Ed detection
    subjectCourseCount.forEach((courses, subjectId) => {
      const upperSubjectId = subjectId.toUpperCase();
      
      // Check if it's a Gen Ed by subject ID patterns or course count
      const isGenEdByPattern = 
        upperSubjectId.includes('LANG') ||
        upperSubjectId.includes('GEED') ||
        upperSubjectId.includes('GE ') ||
        upperSubjectId.includes('CFED') ||
        upperSubjectId.includes('PHED') ||
        upperSubjectId.includes('NSTP') ||
        upperSubjectId.includes('PE ') ||
        upperSubjectId.includes('MATH') && courses.size >= 8 ||
        upperSubjectId.includes('STS') ||
        upperSubjectId.includes('ETHICS') ||
        upperSubjectId.includes('PHILOS') ||
        upperSubjectId.includes('LIT ') ||
        courses.size >= 10; // Lower threshold from 15 to 10
      
      const type = isGenEdByPattern ? 'genEd' : 'major';
      this.subjectTypes.set(subjectId, type);
      
      if (type === 'genEd') {
        console.log(`📚 Gen Ed identified: ${subjectId} (${courses.size} courses)`);
      }
    });
  }

  // ===================================================================
  // NEW ALGORITHM - MAIN SCHEDULING METHOD
  // ===================================================================
  
  // Replace your generateExamSchedule() method in exam-scheduler.component.ts

async generateExamSchedule() {
  if (!this.selectedExamGroup) {
    this.showToast('Error', 'Please select an exam group first', 'destructive');
    return;
  }

  if (this.hasEmptyDates()) {
    this.showToast('Error', 'Please fill in all exam dates', 'destructive');
    return;
  }

  // ✅ ANGULAR 8 COMPATIBLE: Use then() instead of await
  Swal.fire({
    title: '🔄 Loading Exam Data',
    text: 'Fetching exam data from API...',
    allowOutsideClick: false,
    allowEscapeKey: false,
    onBeforeOpen: () => {  // ✅ Angular 8 compatible
      Swal.showLoading();
    }
  });

  try {
    const dataLoaded = await this.loadExamData();
    
    if (!dataLoaded || this.exams.length === 0) {
      Swal.close();
      
      // ✅ ANGULAR 8 COMPATIBLE: Simple fire call
      Swal.fire(
        'Error',
        'No exam data loaded. Please check the API connection.',
        'error'
      );
      return;
    }

    Swal.fire({
      title: '🧠 Generating Schedule',
      text: `Processing ${this.exams.length} exams...`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      onBeforeOpen: () => {
        Swal.showLoading();
      }
    });

    // Small delay to ensure UI updates
    await new Promise(resolve => setTimeout(resolve, 100));

    const numDays = this.examDates.filter(d => d).length;
    const startTime = Date.now();
    
    this.generatedSchedule = algorithmGenerateSchedule(
      this.exams,
      this.rooms,
      numDays
    );

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const stats = this.calculateScheduleStats();

    Swal.close();
    
    // ✅ CRITICAL: Prepare data BEFORE showing dialog
    console.log('📋 Preparing schedule data...');
    this.generateSimpleScheduleData();
    
    // Reset filters
    this.selectedCourse = 'ALL';
    this.selectedYearLevel = 'ALL';
    this.selectedDepartment = 'ALL';
    this.selectedDay = 'ALL';
    this.searchTerm = '';
    
    // Force change detection
    this.cdr.detectChanges();
    
    // Small delay to ensure data is ready
    await new Promise(resolve => setTimeout(resolve, 50));

    // ✅ ANGULAR 8 COMPATIBLE: Use .then() instead of await
    Swal.fire({
      title: '✅ Schedule Generated Successfully!',
      html: `
        <div style="text-align: left; padding: 15px;">
          <div style="background: #e8f5e9; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
            <p style="margin: 0; color: #2e7d32;"><strong>⏱️ Generation Time: ${duration} seconds</strong></p>
          </div>
          
          <h4 style="color: #1565C0; margin-bottom: 10px;">📊 Statistics:</h4>
          <ul style="list-style: none; padding: 0;">
            <li>✅ Total Exams: <strong>${this.exams.length}</strong></li>
            <li>✅ Scheduled: <strong>${stats.scheduled}</strong> (${stats.coverage}%)</li>
            <li>📅 Days: <strong>${numDays}</strong></li>
            <li>🏫 Rooms Used: <strong>${stats.roomsUsed}</strong></li>
            <li>⚠️ Conflicts: <strong>${stats.conflicts}</strong></li>
          </ul>
        </div>
      `,
      type: 'success',  // ✅ Angular 8 uses 'type' not 'icon'
      showCancelButton: true,
      confirmButtonText: '📋 View Schedule',
      cancelButtonText: '✖ Close',
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#6b7280',
      allowOutsideClick: false
    }).then((result) => {  // ✅ Use .then() for Angular 8
      // ✅ ANGULAR 8 COMPATIBLE: Check result.value
      if (result.value) {
        console.log('🎯 User clicked View Schedule - navigating NOW');
        
        // Use setTimeout for safer navigation in Angular 8
        setTimeout(() => {
          this.currentStep = 'simpleschedule';
          this.cdr.detectChanges();
          
          console.log('✅ Navigation complete');
          console.log('📊 Current step:', this.currentStep);
          console.log('📊 Schedule length:', this.generatedSchedule.length);
          console.log('📊 Filtered length:', this.getFilteredSchedule().length);
        }, 0);
      }
    });

  } catch (error) {
    console.error('❌ Error generating schedule:', error);
    Swal.close();
    
    // ✅ ANGULAR 8 COMPATIBLE: Simple fire call
    Swal.fire(
      'Error',
      'Failed to generate schedule. Check console for details.',
      'error'
    );
  }
}

  calculateScheduleStats(): any {
    const scheduled = this.generatedSchedule.length;
    const total = this.exams.length;
    const coverage = ((scheduled / total) * 100).toFixed(1);
    
    // Count unique rooms used
    const roomsUsed = new Set(this.generatedSchedule.map(e => e.ROOM)).size;
    
    // Check for conflicts (should be 0)
    const conflicts = this.detectConflicts();
    
    return {
      scheduled,
      total,
      coverage,
      roomsUsed,
      conflicts
    };
  }

  detectConflicts(): number {
    let conflictCount = 0;
    
    // Group by course-year
    const courseYearGroups: { [key: string]: ScheduledExam[] } = {};
    
    this.generatedSchedule.forEach(exam => {
      const key = `${exam.COURSE}-${exam.YEAR_LEVEL}`;
      if (!courseYearGroups[key]) {
        courseYearGroups[key] = [];
      }
      courseYearGroups[key].push(exam);
    });
    
    // Check each group for conflicts
    Object.values(courseYearGroups).forEach(exams => {
      const slots = new Map<string, Set<string>>();
      
      exams.forEach(exam => {
        const slotKey = `${exam.DAY}-${exam.SLOT}`;
        if (!slots.has(slotKey)) {
          slots.set(slotKey, new Set());
        }
        
        const subjects = slots.get(slotKey);
        if (subjects.has(exam.SUBJECT_ID)) {
          // Same subject, different section - OK
        } else {
          subjects.add(exam.SUBJECT_ID);
        }
      });
      
      // Check if any slot has more than one subject (conflict)
      slots.forEach(subjects => {
        if (subjects.size > 1) {
          conflictCount++;
        }
      });
    });
    
    return conflictCount;
  }

  // ===================================================================
  // SCHEDULE REGENERATION
  // ===================================================================
  
regenerateScheduleForGroup(group: ExamGroup) {
  this.selectedExamGroup = group;
  this.activeTerm = group.termYear || '';
  this.examDates = group.days.map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '').filter(d => d !== '');
  this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
  this.activeDay = this.days[0] || 'Day 1';
  
  this.sharedData.setSelectedExamGroup(group);
  this.sharedData.setExamDates(group.days);
  if (group.termYear) this.sharedData.setActiveTerm(group.termYear);
  
  if (this.exams.length > 0 && this.rooms.length > 0) {
    this.clearScheduleForGroup(group.name, group.termYear || '');
    this.generateExamSchedule();
  } else {
    // ✅ ANGULAR 8 COMPATIBLE
    Swal.fire({
      title: 'Load Exam Data First',
      html: '<p>To regenerate the schedule, you need to load exam data from the API first.</p><br><p>Would you like to load the data now?</p>',
      type: 'question',  // ✅ Angular 8 uses 'type'
      showCancelButton: true,
      confirmButtonText: 'Load Data Now',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#3b82f6'
    }).then((choice) => {  // ✅ Use .then()
      if (choice.value) {  // ✅ Check choice.value
        this.currentStep = 'import';
        this.showToast('Info', 'Click "Load Exam Data from API" to load data, then generate schedule', 'info');
      }
    });
  }
}

  clearScheduleForGroup(groupName: string, termYear: string) {
    const key = `schedule_${groupName}_${termYear}`;
    localStorage.removeItem(key);
    
    if (this.selectedExamGroup && this.selectedExamGroup.name === groupName) {
      this.generatedSchedule = [];
      this.courseSummary = [];
      this.roomTimeData = { table: {}, rooms: [], days: [] };
      this.courseGridData = { grid: {}, courses: [], days: [] };
      
      if (['generate', 'summary', 'timetable', 'coursegrid'].includes(this.currentStep)) {
        this.currentStep = 'import';
      }
    }
  }

  updateScheduleDateMappings(group: ExamGroup) {
    const key = `schedule_${group.name}_${group.termYear}`;
    const saved = localStorage.getItem(key);
    if (!saved) return;
    
    try {
      const scheduleData = JSON.parse(saved);
      const newExamDates = group.days.map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '').filter(d => d !== '');
      
      scheduleData.examDates = newExamDates;
      scheduleData.lastUpdated = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(scheduleData));
      
      if (this.selectedExamGroup && this.selectedExamGroup.name === group.name) {
        this.examDates = newExamDates;
        this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
        this.activeDay = this.days[0] || 'Day 1';
        this.roomTimeData.days = [...this.days];
        this.courseGridData.days = [...this.days];
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error updating date mappings:', error);
    }
  }

  // ===================================================================
  // STORAGE MANAGEMENT
  // ===================================================================
  
  private saveScheduleForGroup(groupName: string, termYear: string) {
    const key = `schedule_${groupName}_${termYear}`;
    const scheduleData = {
      generatedSchedule: this.generatedSchedule,
      exams: this.exams,
      rooms: this.rooms,
      roomCapacities: Array.from(this.roomCapacities.entries()),
      examDates: this.examDates,
      subjectTypes: Array.from(this.subjectTypes.entries()),
      timestamp: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(scheduleData));
  }

  private loadScheduleForGroup(groupName: string, termYear: string): boolean {
    const key = `schedule_${groupName}_${termYear}`;
    const saved = localStorage.getItem(key);
    if (!saved) return false;

    try {
      const scheduleData = JSON.parse(saved);
      this.generatedSchedule = scheduleData.generatedSchedule || [];
      this.exams = scheduleData.exams || [];
      this.rooms = scheduleData.rooms || [];
      this.examDates = scheduleData.examDates || [];
      
      if (scheduleData.roomCapacities) this.roomCapacities = new Map(scheduleData.roomCapacities);
      if (scheduleData.subjectTypes) this.subjectTypes = new Map(scheduleData.subjectTypes);
      
      this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
      this.activeDay = this.days[0] || 'Day 1';
      this.cdr.detectChanges();
      
      return true;
    } catch (err) {
      return false;
    }
  }

  hasScheduleForGroup(groupName: string, termYear: string): boolean {
    return !!localStorage.getItem(`schedule_${groupName}_${termYear}`);
  }


  // Add this method anywhere in your component class (around line 900-1000)

saveCurrentSchedule() {
  if (!this.selectedExamGroup) {
    this.showToast('Error', 'No exam group selected', 'destructive');
    return;
  }

  if (!this.activeTerm) {
    this.showToast('Error', 'No term selected', 'destructive');
    return;
  }

  if (this.generatedSchedule.length === 0) {
    this.showToast('Error', 'No schedule to save', 'destructive');
    return;
  }

  // Save the schedule
  this.saveScheduleForGroup(this.selectedExamGroup.name, this.activeTerm);
  
  // Also save to shared data service for student mapping
  if (this.selectedExamGroup && this.activeTerm) {
    this.sharedData.setStudentMappingForGroup(
      this.selectedExamGroup.name,
      this.activeTerm,
      this.convertScheduleToMappingFormat()
    );
  }

  // ✅ ANGULAR 8 COMPATIBLE: Use type instead of icon
  Swal.fire({
    title: '✅ Schedule Saved!',
    html: `
      <div style="text-align: left; padding: 15px;">
        <p><strong>Exam Group:</strong> ${this.selectedExamGroup.name}</p>
        <p><strong>Term:</strong> ${this.getTermYearLabel(this.activeTerm)}</p>
        <p><strong>Exams Saved:</strong> ${this.generatedSchedule.length}</p>
        <br>
        <p style="color: #10b981;">✅ This schedule is now saved to localStorage</p>
        <p style="color: #666; font-size: 14px;">Next time you select this exam group, you can load this schedule directly!</p>
      </div>
    `,
    type: 'success',  // ✅ Angular 8 uses 'type'
    confirmButtonText: 'OK',
    confirmButtonColor: '#10b981'
  });

  console.log('✅ Schedule saved:', {
    group: this.selectedExamGroup.name,
    term: this.activeTerm,
    exams: this.generatedSchedule.length,
    key: `schedule_${this.selectedExamGroup.name}_${this.activeTerm}`
  });
}

  saveToLocalStorage() {
    const dataToSave = {
      activeTerm: this.activeTerm,
      exams: this.exams,
      rooms: this.rooms,
      generatedSchedule: this.generatedSchedule,
      examDates: this.examDates,
      currentStep: this.currentStep,
      selectedExamGroup: this.selectedExamGroup
    };
    localStorage.setItem('examScheduleData', JSON.stringify(dataToSave));
    
    if (this.selectedExamGroup && this.activeTerm) {
      this.saveScheduleForGroup(this.selectedExamGroup.name, this.activeTerm);
      this.sharedData.setStudentMappingForGroup(
        this.selectedExamGroup.name,
        this.activeTerm,
        this.convertScheduleToMappingFormat()
      );
    }
    
    this.global.swalSuccess("Schedule saved to local storage!");
  }

  private convertScheduleToMappingFormat(): any[] {
    return this.examDates.map(date => ({
      date,
      programs: Array.from(
        this.generatedSchedule
          .filter(e => e.DAY === this.days[this.examDates.indexOf(date)])
          .reduce((map, exam) => {
            const key = `${exam.COURSE}_${exam.YEAR_LEVEL}`;
            if (!map.has(key)) {
              map.set(key, {
                program: exam.COURSE,
                year: exam.YEAR_LEVEL,
                subjects: []
              });
            }
            map.get(key).subjects.push({
              subjectId: exam.SUBJECT_ID,
              subjectTitle: exam.DESCRIPTIVE_TITLE,
              codeNo: exam.CODE,
              sched: exam.SLOT
            });
            return map;
          }, new Map()).values()
      )
    }));
  }

  // ===================================================================
  // VIEW GENERATION
  // ===================================================================
  
  generateCourseSummaryData() {
    const summaryMap: { [course: string]: ScheduledExam[] } = {};
    this.generatedSchedule.forEach(exam => {
      if (!summaryMap[exam.COURSE]) summaryMap[exam.COURSE] = [];
      summaryMap[exam.COURSE].push(exam);
    });

    this.courseSummary = Object.keys(summaryMap).sort().map(course => {
      const courseExams = summaryMap[course].sort((a, b) => {
        if (a.YEAR_LEVEL !== b.YEAR_LEVEL) return a.YEAR_LEVEL - b.YEAR_LEVEL;
        if (a.DAY !== b.DAY) return a.DAY.localeCompare(b.DAY);
        return a.SLOT.localeCompare(b.SLOT);
      });

      const yearLevelGroups: { [yearLevel: number]: any[] } = {};
      
      courseExams.forEach(exam => {
        const yearLevel = exam.YEAR_LEVEL || 1;
        if (!yearLevelGroups[yearLevel]) yearLevelGroups[yearLevel] = [];
        
        let group = yearLevelGroups[yearLevel].find(g => g.day === exam.DAY && g.slot === exam.SLOT);
        if (!group) {
          group = { day: exam.DAY, slot: exam.SLOT, exams: [] };
          yearLevelGroups[yearLevel].push(group);
        }
        group.exams.push(exam);
      });

      return {
        course,
        yearLevelGroups: Object.keys(yearLevelGroups)
          .map(Number)
          .sort((a, b) => a - b)
          .map(yearLevel => ({ yearLevel, groups: yearLevelGroups[yearLevel] }))
      };
    });
  }

  viewCourseSummary() {
    this.generateCourseSummaryData();
    this.currentStep = 'summary';
  }

  generateRoomTimeTableData() {
    const uniqueRooms = Array.from(new Set(this.generatedSchedule.map(e => e.ROOM))).sort();
    const uniqueDays = Array.from(new Set(this.generatedSchedule.map(e => e.DAY)));

    const table: any = {};
    uniqueDays.forEach(day => {
      table[day] = {};
      uniqueRooms.forEach(room => {
        table[day][room] = {};
        this.timeSlots.forEach(slot => {
          table[day][room][slot] = null;
        });
      });
    });

    this.generatedSchedule.forEach(exam => {
      table[exam.DAY][exam.ROOM][exam.SLOT] = {
        code: exam.CODE,
        course: exam.COURSE,
        yearLevel: exam.YEAR_LEVEL || 1,
        dept: exam.DEPT,
        title: exam.DESCRIPTIVE_TITLE
      };
    });

    this.roomTimeData = { table, rooms: uniqueRooms, days: uniqueDays };
    this.activeDay = uniqueDays[0] || 'Day 1';
  }

  viewRoomTimeTable() {
    this.generateRoomTimeTableData();
    this.currentStep = 'timetable';
  }

  generateCourseGridData() {
    const uniqueCourses = Array.from(new Set(this.generatedSchedule.map(e => e.COURSE))).sort();
    const uniqueDays = Array.from(new Set(this.generatedSchedule.map(e => e.DAY)));

    const grid: any = {};
    uniqueDays.forEach(day => {
      grid[day] = {};
      uniqueCourses.forEach(course => {
        grid[day][course] = {};
        this.timeSlots.forEach(slot => {
          grid[day][course][slot] = [];
        });
      });
    });

    this.generatedSchedule.forEach(exam => {
      if (!grid[exam.DAY][exam.COURSE][exam.SLOT]) {
        grid[exam.DAY][exam.COURSE][exam.SLOT] = [];
      }
      grid[exam.DAY][exam.COURSE][exam.SLOT].push({
        subjectId: exam.SUBJECT_ID,
        title: exam.DESCRIPTIVE_TITLE,
        code: exam.CODE,
        room: exam.ROOM,
        dept: exam.DEPT,
        yearLevel: exam.YEAR_LEVEL || 1
      });
    });

    uniqueDays.forEach(day => {
      uniqueCourses.forEach(course => {
        this.timeSlots.forEach(slot => {
          if (grid[day][course][slot].length > 0) {
            grid[day][course][slot].sort((a: any, b: any) => a.yearLevel - b.yearLevel);
          }
        });
      });
    });

    this.courseGridData = { grid, courses: uniqueCourses, days: uniqueDays };
  }

  viewCourseGrid() {
    this.generateCourseGridData();
    this.currentStep = 'coursegrid';
    this.cdr.detectChanges();
  }


 clearSearch() {
  this.searchTerm = '';
  this.filteredScheduleCache = [];
  this.updateFilteredSchedule();
}


  getUniqueDepartments(): string[] {
  console.log('🔍 Getting unique departments...');
  const departments = new Set<string>();
  this.generatedSchedule.forEach(exam => {
    if (exam.DEPT) departments.add(exam.DEPT);
  });
  const result = ['ALL', ...Array.from(departments).sort()];
  console.log('✅ Unique departments:', result);
  return result;
}


  // ===================================================================
  // EDITING METHODS
  // ===================================================================
  
  startEdit(index: number) {
    this.editingRow = index;
    this.editedExam = { ...this.generatedSchedule[index] };
  }

  cancelEdit() {
    this.editingRow = null;
    this.editedExam = null;
  }

  saveEdit() {
    if (this.editingRow !== null && this.editedExam) {
      this.generatedSchedule[this.editingRow] = this.editedExam;
      this.editingRow = null;
      this.editedExam = null;
      this.showToast('Saved', 'Exam updated successfully');
    }
  }

  updateEditField(field: keyof ScheduledExam, value: any) {
    if (this.editedExam) {
      (this.editedExam as any)[field] = value;
    }
  }

  // ===================================================================
  // EXAM MOVING
  // ===================================================================
  
  showMoveOptions(exam: ScheduledExam, day: string, slot: string) {
    if (!exam) {
      this.showToast('Error', 'Exam not found', 'destructive');
      return;
    }

    const group = this.generatedSchedule.filter(e => 
      e.SUBJECT_ID.toUpperCase().trim() === exam.SUBJECT_ID.toUpperCase().trim()
    );

    this.moveExamData = { examRef: exam, groupExams: group };
    this.safeSlots = this.findSafeSlotsForGroup(group);
    this.movePopupVisible = true;
  }

  closeMovePopup() {
    this.movePopupVisible = false;
  }


 // Add this method if you haven't already
selectActiveDay(day: string): void {
  console.log('📅 Selecting day:', day);
  console.log('📅 Current activeDay:', this.activeDay);
  
  this.activeDay = day;
  
  console.log('📅 New activeDay:', this.activeDay);
  
  // Force Angular to detect changes
  this.cdr.detectChanges();
  
  console.log('✅ Day selection complete');
}

  applyMove(newDay: string, newSlot: string) {
    if (!this.moveExamData || !this.moveExamData.groupExams) {
      this.showToast('Error', 'No exams selected to move', 'destructive');
      return;
    }

    const group = this.moveExamData.groupExams;

    for (let exam of group) {
      exam.DAY = newDay;
      exam.SLOT = newSlot;

      const occupiedRooms = this.generatedSchedule
        .filter(e => e.DAY === newDay && e.SLOT === newSlot && e !== exam)
        .map(e => e.ROOM);

      const availableRoom = this.rooms.find(r => !occupiedRooms.includes(r));
      if (availableRoom) exam.ROOM = availableRoom;
    }

    if (this.currentStep === 'coursegrid') {
      this.generateCourseGridData();
    }

    this.movePopupVisible = false;
    this.showToast('Updated', `${group.length} exams moved to ${newDay} ${newSlot}`);
  }

  findSafeSlotsForGroup(group: ScheduledExam[]): SafeSlotOption[] {
    const safe: SafeSlotOption[] = [];

    for (let day of this.days) {
      for (let slot of this.timeSlots) {
        const safeForAll = group.every(exam => this.isSlotSafeForExam(exam, day, slot));

        if (safeForAll) {
          const usedRooms = new Set(
            this.generatedSchedule
              .filter(e => e.DAY === day && e.SLOT === slot && !group.includes(e))
              .map(e => e.ROOM)
          );

          group.forEach(e => usedRooms.delete(e.ROOM));
          const availableRooms = this.rooms.filter(r => !usedRooms.has(r));
          
          if (availableRooms.length >= group.length) {
            safe.push({ day, slot, availableRooms: availableRooms.slice(0, group.length) });
          }
        }
      }
    }

    return safe;
  }

  isSlotSafeForExam(exam: ScheduledExam, day: string, slot: string) {
    return !this.generatedSchedule.some(e =>
      e.DAY === day &&
      e.SLOT === slot &&
      e.COURSE === exam.COURSE &&
      e.SUBJECT_ID !== exam.SUBJECT_ID
    );
  }

  getFullExam(gridExam: any, day: string, slot: string): ScheduledExam | undefined {
    return this.generatedSchedule.find(e =>
      e.CODE === gridExam.code && e.DAY === day && e.SLOT === slot
    );
  }

  removeExamByTitle(title: string) {
    if (confirm(`Remove exam "${title}"?`)) {
      this.generatedSchedule = this.generatedSchedule.filter(e => e.DESCRIPTIVE_TITLE !== title);
      this.generateCourseGridData();
      this.showToast('Removed', `Exam "${title}" removed`);
    }
  }

// Method to navigate to room grid
viewRoomScheduleGrid() {
  console.log('📅 viewRoomScheduleGrid() called');
  this.currentStep = 'roomgrid';
  this.activeDay = this.days[0];
  this.cdr.detectChanges();
}

// Get sorted list of rooms
getRoomsForGrid(): string[] {
  const roomsInSchedule = new Set<string>();
  this.generatedSchedule.forEach(exam => {
    if (exam.ROOM) roomsInSchedule.add(exam.ROOM);
  });
  
  return Array.from(roomsInSchedule).sort((a, b) => {
    // Sort by building letter, then by room number
    const aBuilding = a.charAt(0);
    const bBuilding = b.charAt(0);
    
    if (aBuilding !== bBuilding) {
      return aBuilding.localeCompare(bBuilding);
    }
    
    // ✅ FIXED: Use traditional approach instead of optional chaining
    const aMatch = a.match(/\d+/);
    const aNum = parseInt(aMatch ? aMatch[0] : '0');
    
    const bMatch = b.match(/\d+/);
    const bNum = parseInt(bMatch ? bMatch[0] : '0');
    
    return aNum - bNum;
  });
}

// Get data for a specific room and time slot
getRoomSlotData(room: string, slot: string, day: string): any {
  const exam = this.generatedSchedule.find(e => 
    e.ROOM === room && e.SLOT === slot && e.DAY === day
  );
  
  if (!exam) return null;
  
  return {
    code: exam.CODE,
    subjectId: exam.SUBJECT_ID,
    course: exam.COURSE,
    year: exam.YEAR_LEVEL,
    dept: exam.DEPT,
    bgColor: this.getDeptColor(exam.DEPT)
  };
}

// Get count of occupied slots for a day
getOccupiedSlotsCount(day: string): number {
  return this.generatedSchedule.filter(e => e.DAY === day).length;
}

// Get utilization percentage
getUtilizationPercent(day: string): string {
  const totalSlots = this.getRoomsForGrid().length * this.timeSlots.length;
  const occupied = this.getOccupiedSlotsCount(day);
  
  if (totalSlots === 0) return '0.0';
  
  return ((occupied / totalSlots) * 100).toFixed(1);
}

// Download room grid as Excel
downloadRoomGridExcel() {
  // Create workbook with one sheet per day
  const wb: XLSX.WorkBook = XLSX.utils.book_new();
  
  this.days.forEach(day => {
    const rooms = this.getRoomsForGrid();
    const data: any[] = [];
    
    // Header row
    const headerRow = ['ROOM', ...this.timeSlots];
    data.push(headerRow);
    
    // Data rows
    rooms.forEach(room => {
      const row = [room];
      
      this.timeSlots.forEach(slot => {
        const slotData = this.getRoomSlotData(room, slot, day);
        row.push(slotData ? slotData.code : '');
      });
      
      data.push(row);
    });
    
    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(data);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 10 }, // Room column
      ...this.timeSlots.map(() => ({ wch: 12 })) // Time slot columns
    ];
    
    const sheetName = this.getDayName(day).substring(0, 31); // Excel sheet name limit
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  
  const fileName = this.selectedExamGroup 
    ? `${this.selectedExamGroup.name}_Room_Grid.xlsx`
    : 'Room_Schedule_Grid.xlsx';
  
  XLSX.writeFile(wb, fileName);
  
  this.showToast('Success', 'Room grid exported to Excel');
}



  // ===================================================================
  // UTILITY METHODS
  // ===================================================================
  
  downloadScheduleCSV() {
    if (this.generatedSchedule.length === 0) return;

    const headers = ['Code', 'Subject ID', 'Title', 'Course', 'Year Level', 'Instructor', 'Dept', 'Day', 'Time', 'Room'];
    const csv = [
      headers.join(','),
      ...this.generatedSchedule.map(item => [
        item.CODE, item.SUBJECT_ID, item.DESCRIPTIVE_TITLE, item.COURSE,
        item.YEAR_LEVEL, item.INSTRUCTOR, item.DEPT, item.DAY, item.SLOT, item.ROOM
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const groupName = (this.selectedExamGroup && this.selectedExamGroup.name) || 'export';
    saveAs(blob, `exam_schedule_${groupName}_ENHANCED.csv`);
  }

  getDeptColor(dept: string): string {
  const colors: { [key: string]: string } = {
    'SACE': '#ef4444',    // Red
    'SABH': '#facc15',    // Yellow
    'SECAP': '#3b82f6',   // Blue
    'SHAS': '#22c55e'     // Green
  };
  return dept ? colors[dept.toUpperCase()] || '#6b7280' : '#6b7280';
}

 goToStep(step: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' | 'simpleschedule' | 'roomgrid' | 'studentmapping'): void {
  console.log('🔄 Navigating to step:', step);
  this.currentStep = step;
  
  // Reset active day when going to steps with day tabs
  if (step === 'roomgrid' || step === 'timetable' || step === 'coursegrid') {
    this.activeDay = this.days[0] || 'Day 1';
  }
  
  this.cdr.detectChanges();
}
  getTermYearLabel(termYearCode: string): string {
    if (!termYearCode) return 'Unknown';
    if (termYearCode.includes('Semester') || termYearCode.includes('Summer')) return termYearCode;
    
    if (/^\d{7}$/.test(termYearCode)) {
      const termMap: any = { '1': '1st Semester', '2': '2nd Semester', '3': 'Summer' };
      const termCode = termYearCode.slice(-1);
      const year1 = termYearCode.slice(0, 4);
      const year2 = '20' + termYearCode.slice(4, 6);
      return `${termMap[termCode] || 'Unknown'} SY ${year1}-${year2}`;
    }
    
    return 'Unknown';
  }

  getDateRange(days: ExamDay[]): string {
    if (!days || days.length === 0) return '-';

    const sorted = [...days].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());

    return sorted.map(d => {
      const dt = new Date(d.date!);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const yy = String(dt.getFullYear()).slice(-2);
      const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
      return `${mm}/${dd}/${yy} (${weekday})`;
    }).join(', ');
  }

  hasEmptyDates(): boolean {
    return this.examDates.some(d => !d);
  }

  hasExamsForYear(course: string, year: number, day: string): boolean {
    if (!this.courseGridData.grid || !this.courseGridData.grid[day] || !this.courseGridData.grid[day][course]) {
      return false;
    }
    
    return Object.values(this.courseGridData.grid[day][course])
      .some((exams: any) => exams.some((exam: any) => exam.yearLevel === year));
  }

  openDatePickerDialog() {
    const dialogRef = this.dialog.open(DatePickerComponent, {
      width: '800px',
      maxHeight: '90vh',
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(() => {
      this.loadSavedExamGroups();
      this.cdr.detectChanges();
    });
  }

  loadSwal() {
    Swal.fire({
      title: 'Loading',
      text: 'Fetching exam data...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: () => Swal.showLoading()
    });
  }

  showToast(title: string, description: string, variant: string = 'success') {
    this.toast = { title, description, variant };
    setTimeout(() => this.toast = null, 3000);
  }

  viewSimpleSchedule() {
  console.log('📋 viewSimpleSchedule() called');
  console.log('📋 Schedule length:', this.generatedSchedule.length);
  
  if (this.generatedSchedule.length === 0) {
    this.showToast('Error', 'No schedule data available', 'destructive');
    return;
  }
  
  // Prepare data
  this.generateSimpleScheduleData();
  
  // Reset ALL filters
  this.selectedCourse = 'ALL';
  this.selectedYearLevel = 'ALL';
  this.selectedDepartment = 'ALL';
  this.selectedDay = 'ALL'; // 



  
  
  // Navigate
  this.currentStep = 'simpleschedule';
  
  // Force UI update
  this.cdr.detectChanges();
  
  console.log('✅ Navigated to simple schedule view');

  
  // Prepare data
  this.generateSimpleScheduleData();
  
  // Reset filters
  this.selectedCourse = 'ALL';
  this.selectedYearLevel = 'ALL';
  this.selectedDepartment = 'ALL';
  
  // Navigate
  this.currentStep = 'simpleschedule';
  
  // Force UI update
  this.cdr.detectChanges();
  
  console.log('✅ Navigated to simple schedule view');
}


clearFilters() {
  this.selectedCourse = 'ALL';
  this.selectedYearLevel = 'ALL';
  this.selectedDepartment = 'ALL';
  this.selectedDay = 'ALL';
  this.searchTerm = '';
  this.filteredScheduleCache = [];
  this.updateFilteredSchedule();
}

generateSimpleScheduleData() {
  this.generatedSchedule.sort((a, b) => {
    const codeA = parseInt(a.CODE) || 0;
    const codeB = parseInt(b.CODE) || 0;
    return codeA - codeB;
  });
}

getUniqueCourses(): string[] {
  console.log('🔍 Getting unique courses...');
  const courses = new Set<string>();
  this.generatedSchedule.forEach(exam => {
    if (exam.COURSE) courses.add(exam.COURSE);
  });
  const result = ['ALL', ...Array.from(courses).sort()];
  console.log('✅ Unique courses:', result);
  return result;
}


getUniqueYearLevels(): string[] {
  console.log('🔍 Getting unique year levels...');
  const years = new Set<string>();
  this.generatedSchedule.forEach(exam => {
    if (exam.YEAR_LEVEL) years.add(exam.YEAR_LEVEL.toString());
  });
  const result = ['ALL', ...Array.from(years).sort((a, b) => {
    if (a === 'ALL') return -1;
    if (b === 'ALL') return 1;
    return parseInt(a) - parseInt(b);
  })];
  console.log('✅ Unique years:', result);
  return result;
}

getFilteredSchedule(): ScheduledExam[] {
    // If cache is empty, calculate it
    if (this.filteredScheduleCache.length === 0 && this.generatedSchedule.length > 0) {
      this.filteredScheduleCache = this.calculateFilteredSchedule();
    }
    return this.filteredScheduleCache;
  }

// ✅ NEW: Debounced search input handler
  onSearchInput() {
    this.searchSubject.next(this.searchTerm);
  }

  // ✅ NEW: Update filtered schedule cache
  private updateFilteredSchedule() {
    this.filteredScheduleCache = this.calculateFilteredSchedule();
    this.cdr.detectChanges();
  }

  // ✅ NEW: Calculate filtered results (called less frequently)
  private calculateFilteredSchedule(): ScheduledExam[] {
    return this.generatedSchedule.filter(exam => {
      // Course filter
      if (this.selectedCourse !== 'ALL' && exam.COURSE !== this.selectedCourse) {
        return false;
      }
      
      // Year level filter
      if (this.selectedYearLevel !== 'ALL') {
        if (exam.YEAR_LEVEL.toString() !== this.selectedYearLevel && 
            exam.YEAR_LEVEL !== parseInt(this.selectedYearLevel)) {
          return false;
        }
      }
      
      // Department filter
      if (this.selectedDepartment !== 'ALL' && exam.DEPT !== this.selectedDepartment) {
        return false;
      }
      
      // Day filter
      if (this.selectedDay !== 'ALL' && exam.DAY !== this.selectedDay) {
        return false;
      }
      
      // Search filter (case-insensitive)
      if (this.searchTerm && this.searchTerm.trim() !== '') {
        const searchLower = this.searchTerm.toLowerCase().trim();
        const matchFound = 
          exam.SUBJECT_ID.toLowerCase().includes(searchLower) ||
          exam.CODE.toLowerCase().includes(searchLower) ||
          exam.DESCRIPTIVE_TITLE.toLowerCase().includes(searchLower) ||
          exam.INSTRUCTOR.toLowerCase().includes(searchLower);
        
        if (!matchFound) return false;
      }
      
      return true;
    });
  }

formatTimeForDisplay(slot: string): string {
  const parts = slot.split('-');
  if (parts.length !== 2) return slot;
  
  const formatTime = (time: string) => {
    const [hours, mins] = time.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHour = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    // FIX: Don't pad single digit hours - it makes 3 PM look like 03 AM
    return `${displayHour}:${mins}${ampm}`;
  };
  
  return `${formatTime(parts[0])}-${formatTime(parts[1])}`;
}

onFilterChange() {
    this.updateFilteredSchedule();
  }

getDayName(day: string): string {
  console.log('🔍 Getting day name for:', day);
  
  // Map Day 1, Day 2, Day 3 to actual exam dates
  const dayIndex = this.days.indexOf(day);
  
  if (dayIndex === -1 || dayIndex >= this.examDates.length) {
    console.warn('⚠️ Invalid day:', day);
    return day;
  }
  
  const examDate = this.examDates[dayIndex];
  
  if (!examDate) {
    console.warn('⚠️ No exam date for day:', day);
    return day;
  }
  
  // Convert the date string to a Date object
  const dateObj = new Date(examDate + 'T00:00:00'); // Add time to avoid timezone issues
  
  // Get the day name (e.g., "Monday")
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  
  // Format the date (e.g., "01/27/2025")
  const formattedDate = dateObj.toLocaleDateString('en-US', { 
    month: '2-digit', 
    day: '2-digit', 
    year: 'numeric' 
  });
  
  // Return format: "Monday, 01/27/2025"
  const result = `${dayName}, ${formattedDate}`;
  
  console.log('✅ Converted', day, 'to:', result);
  return result;
}


getExamDays(): { label: string, value: string }[] {
  const options = [{ label: 'ALL DAYS', value: 'ALL' }];
  
  this.days.forEach((day, index) => {
    if (this.examDates[index]) {
      const dateObj = new Date(this.examDates[index] + 'T00:00:00');
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      const formattedDate = dateObj.toLocaleDateString('en-US', { 
        month: '2-digit', 
        day: '2-digit',
        year: 'numeric'
      });
      
      options.push({
        label: `${day} - ${dayName}, ${formattedDate}`,
        value: day
      });
    } else {
      options.push({
        label: day,
        value: day
      });
    }
  });
  
  return options;
}


downloadSimpleScheduleExcel() {
  const filtered = this.getFilteredSchedule();
  
  if (filtered.length === 0) {
    this.showToast('Error', 'No data to export', 'destructive');
    return;
  }

  const excelData = filtered.map(exam => ({
    'Code No': exam.CODE,
    'Subject ID': exam.SUBJECT_ID,
    'Descriptive Title': exam.DESCRIPTIVE_TITLE,
    'Course': exam.COURSE,
    'Year Level': exam.YEAR_LEVEL,
    'Day': this.getDayName(exam.DAY),
    'Time': this.formatTimeForDisplay(exam.SLOT),
    'Room': exam.ROOM,
    'Instructor': exam.INSTRUCTOR,
    'Department': exam.DEPT
  }));

  const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(excelData);
  
  ws['!cols'] = [
    { wch: 8 }, { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 10 },
    { wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 30 }, { wch: 12 }
  ];

  const wb: XLSX.WorkBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Exam Schedule');

  const fileName = this.selectedExamGroup 
    ? `${this.selectedExamGroup.name}_Schedule.xlsx`
    : 'Exam_Schedule.xlsx';

  XLSX.writeFile(wb, fileName);
  
  this.showToast('Success', `Exported ${filtered.length} exams to Excel`);
}


// ===================================================================
// STUDENT MAPPING METHODS
// ===================================================================

viewStudentMapping() {
  console.log('📚 viewStudentMapping() called');
  this.currentStep = 'studentmapping';
  this.cdr.detectChanges();
}

getStudentMappingData(): { courseYear: string, course: string, year: number }[] {
  // Get unique course-year combinations
  const combinations = new Set<string>();
  
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.COURSE}_${exam.YEAR_LEVEL}`;
    combinations.add(key);
  });
  
  // Convert to array and sort
  const result = Array.from(combinations)
    .map(key => {
      const [course, year] = key.split('_');
      return {
        courseYear: `${course} - ${year}`,
        course: course,
        year: parseInt(year)
      };
    })
    .sort((a, b) => {
      // Sort by course name, then by year
      if (a.course !== b.course) {
        return a.course.localeCompare(b.course);
      }
      return a.year - b.year;
    });
  
  console.log('📚 Student mapping data:', result.length, 'combinations');
  return result;
}

getStudentMappingCell(course: string, year: number, day: string, slot: string): any {
  // Find all exams for this course-year-day-slot combination
  const exams = this.generatedSchedule.filter(e => 
    e.COURSE === course && 
    e.YEAR_LEVEL === year && 
    e.DAY === day && 
    e.SLOT === slot
  );
  
  if (exams.length === 0) return null;
  
  // If multiple subjects in same slot (shouldn't happen with proper scheduling)
  // show the first one
  const exam = exams[0];
  
  return {
    subjectId: exam.SUBJECT_ID,
    code: exam.CODE,
    title: exam.DESCRIPTIVE_TITLE,
    dept: exam.DEPT,
    bgColor: this.getDeptColor(exam.DEPT)
  };
}

downloadStudentMappingExcel() {
  const wb: XLSX.WorkBook = XLSX.utils.book_new();
  const mappingData = this.getStudentMappingData();
  
  if (mappingData.length === 0) {
    this.showToast('Error', 'No data to export', 'destructive');
    return;
  }
  
  // Create data array for Excel
  const excelData: any[] = [];
  
  // Header row 1: Day names
  const headerRow1 = ['PROGRAM - YEAR'];
  this.days.forEach(day => {
    const dayName = this.getDayName(day);
    // Add day name spanning all time slots
    headerRow1.push(dayName);
    // Fill remaining time slot columns for this day
    for (let i = 1; i < this.timeSlots.length; i++) {
      headerRow1.push('');
    }
  });
  excelData.push(headerRow1);
  
  // Header row 2: Time slots
  const headerRow2 = [''];
  this.days.forEach(day => {
    this.timeSlots.forEach(slot => {
      headerRow2.push(slot);
    });
  });
  excelData.push(headerRow2);
  
  // Data rows
  mappingData.forEach(mapping => {
    const row = [mapping.courseYear];
    
    this.days.forEach(day => {
      this.timeSlots.forEach(slot => {
        const cellData = this.getStudentMappingCell(mapping.course, mapping.year, day, slot);
        row.push(cellData ? cellData.subjectId : '');
      });
    });
    
    excelData.push(row);
  });
  
  // Create worksheet
  const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(excelData);
  
  // Merge day header cells
  const merges: XLSX.Range[] = [];
  let colIndex = 1; // Start after program-year column
  this.days.forEach((day, dayIdx) => {
    merges.push({
      s: { r: 0, c: colIndex },
      e: { r: 0, c: colIndex + this.timeSlots.length - 1 }
    });
    colIndex += this.timeSlots.length;
  });
  ws['!merges'] = merges;
  
  // Set column widths
  const colWidths = [{ wch: 20 }]; // Program-year column
  this.days.forEach(() => {
    this.timeSlots.forEach(() => {
      colWidths.push({ wch: 12 }); // Time slot columns
    });
  });
  ws['!cols'] = colWidths;
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Student Mapping');
  
  // Generate filename
  const fileName = this.selectedExamGroup 
    ? `${this.selectedExamGroup.name}_Student_Mapping.xlsx`
    : 'Student_Mapping.xlsx';
  
  // Download file
  XLSX.writeFile(wb, fileName);
  
  this.showToast('Success', 'Student mapping exported to Excel');
}

}