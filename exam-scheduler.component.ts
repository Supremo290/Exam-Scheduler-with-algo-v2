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
  SubjectPriority,
  RoomPreference,
  SchedulingState,
  SlotOption,
  ProctorAssignment,
  ProctorSuggestion,
  ProctorMatchType,
  ProctorMatchDetails,
  ProctorStatistics
} from '../subject-code';

import { 
  convertTo12HourFormat, 
  getFilteredTimeSlots, 
  getDisplayTimeSlots,
  getTimeSlotsForDay,
  getDisplayTimeSlotsForDay,
  isSlotIncluded,
  TimeSlotConfig 
} from './time-utils';

@Component({
  selector: 'app-exam-scheduler',
  templateUrl: './exam-scheduler.component.html',
  styleUrls: ['./exam-scheduler.component.scss']
})
export class ExamSchedulerComponent implements OnInit {
  // State management
 currentStep: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' | 'simpleschedule' | 'roomgrid' | 'studentmapping' | 'proctor' = 'import';
 isLoadingApi: boolean = false;
 selectedTabIndex: number = 0;
  
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
  
allTimeSlots: string[] = [
  '7:30-9:00', '9:00-10:30', '10:30-12:00', '12:00-13:30',
  '13:30-15:00', '15:00-16:30', '16:30-18:00', '18:00-19:30'
];

timeSlots: string[] = []; // Will be dynamically generated
displayTimeSlots: string[] = []; 
  
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


  // Core proctor data
  proctorAssignments: Map<string, ProctorAssignment> = new Map();
  conflictingExams: ScheduledExam[] = [];
  availableProctors: Map<string, string[]> = new Map();
  
  // Instructor metadata
  instructorSchedule: Record<string, { day: string; slot: string }[]> = {};
  instructorSubjects: Map<string, Set<string>> = new Map();
  instructorDepartments: Map<string, string> = new Map();
  
  // Filtering
  proctorSearchQuery: string = '';
  selectedProctorDept: string = '';
  selectedProctorSubject: string = '';
  showProctorSuggestions: boolean = true;
  
  // Performance optimization
  private proctorSuggestionsCache = new Map<string, ProctorSuggestion>();
  private proctorSuggestionsMap = new Map<string, ProctorSuggestion>();
  private allProctorsMap = new Map<string, string[]>();
  private filteredProctorList: ScheduledExam[] = [];
  private processingCancelled = false;
  private filterDebounceTimer: any;
  private deptProgramMap: Map<string, Set<string>> = new Map();
  
  // ===================================================================
  // ✅ UNSCHEDULED EXAMS PROPERTIES
  // ===================================================================
  
  unscheduledExams: Exam[] = [];
  showUnscheduledPanel: boolean = false;
  editingUnscheduledExam: Exam | null = null;
  editFormData: any = null;




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
    this.updateTimeSlotsFromExamGroup();
    
    this.sharedData.selectedExamGroup$.subscribe(group => {
      if (group) {
        this.selectedExamGroup = group;
        this.examDates = group.days.map(d => 
          d.date ? new Date(d.date).toLocaleDateString('en-CA') : ''
        );
        this.updateTimeSlotsFromExamGroup();
        this.activeTerm = group.termYear || '';
        this.updateTimeSlotsFromExamGroup();
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


   (window as any).debugSchedule = () => {
    console.log('=== DEBUG INFO ===');
    console.log('Current step:', this.currentStep);
    console.log('Generated schedule length:', this.generatedSchedule ? this.generatedSchedule.length : 0);
    console.log('First 3 exams:', this.generatedSchedule ? this.generatedSchedule.slice(0, 3) : []);
    console.log('Days:', this.days);
    console.log('Exam dates:', this.examDates);
    console.log('==================');
  };

  }


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

  /**
 * Update time slots based on selected exam group's AM/PM configuration
 */
updateTimeSlotsFromExamGroup() {
  if (!this.selectedExamGroup || !this.selectedExamGroup.days) {
    this.timeSlots = [...this.allTimeSlots];
    this.displayTimeSlots = this.allTimeSlots.map(slot => convertTo12HourFormat(slot));
    return;
  }

  const allSameConfig = this.selectedExamGroup.days.every(day => 
    day.am === this.selectedExamGroup!.days[0].am && 
    day.pm === this.selectedExamGroup!.days[0].pm
  );

  if (allSameConfig) {
    const firstDay = this.selectedExamGroup.days[0];
    this.timeSlots = getFilteredTimeSlots(firstDay.am, firstDay.pm);
    this.displayTimeSlots = this.timeSlots.map(slot => convertTo12HourFormat(slot));
  } else {
    this.timeSlots = [...this.allTimeSlots];
    this.displayTimeSlots = this.allTimeSlots.map(slot => convertTo12HourFormat(slot));
  }

  console.log('✅ Time slots updated:', this.timeSlots);
  console.log('✅ Display time slots:', this.displayTimeSlots);
}

getTimeSlotsForSpecificDay(dayIndex: number): string[] {
  if (!this.selectedExamGroup || !this.selectedExamGroup.days || 
      dayIndex >= this.selectedExamGroup.days.length) {
    return this.timeSlots;
  }
  return getTimeSlotsForDay(dayIndex, this.selectedExamGroup.days);
}

getDisplayTimeSlotsForSpecificDay(dayIndex: number): string[] {
  if (!this.selectedExamGroup || !this.selectedExamGroup.days || 
      dayIndex >= this.selectedExamGroup.days.length) {
    return this.displayTimeSlots;
  }
  return getDisplayTimeSlotsForDay(dayIndex, this.selectedExamGroup.days);
}

shouldShowSlotForDay(slot: string, dayIndex: number): boolean {
  if (!this.selectedExamGroup || !this.selectedExamGroup.days || 
      dayIndex >= this.selectedExamGroup.days.length) {
    return true;
  }
  const dayConfig = this.selectedExamGroup.days[dayIndex];
  return isSlotIncluded(slot, { am: dayConfig.am, pm: dayConfig.pm });
}

formatSlotFor12Hour(slot: string): string {
  return convertTo12HourFormat(slot);
}

getTimeRangeForDay(dayIndex: number): string {
  if (!this.selectedExamGroup || !this.selectedExamGroup.days || 
      dayIndex >= this.selectedExamGroup.days.length) {
    return '';
  }
  
  const day = this.selectedExamGroup.days[dayIndex];
  
  if (day.am && day.pm) {
    return '7:30 AM - 7:30 PM';
  } else if (day.am) {
    return '7:30 AM - 12:00 PM';
  } else if (day.pm) {
    return '12:00 PM - 7:30 PM';
  }
  
  return '';
}

  loadSavedExamGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }


  toggleExamGroupManager() {
    this.showExamGroupManager = !this.showExamGroupManager;
  }

selectExamGroup(group: ExamGroup) {
  if (this.selectedExamGroup && this.selectedExamGroup.name === group.name) {
    return;
  }

  this.selectedExamGroup = group;
  this.sharedData.setSelectedExamGroup(group);
  this.sharedData.setActiveTerm(group.termYear || '');
  this.activeTerm = group.termYear || '';

  this.examDates = group.days.map(d => 
    d.date ? new Date(d.date).toLocaleDateString('en-CA') : ''
  );

  this.updateTimeSlotsFromExamGroup();

  // ✅ CHECK FOR SAVED SCHEDULE
  if (group.termYear && this.hasScheduleForGroup(group.name, group.termYear)) {
    console.log(`📂 Found saved schedule for ${group.name}`);
    
    const loaded = this.loadScheduleForGroup(group.name, group.termYear);
    
    if (loaded && this.generatedSchedule.length > 0) {
      Swal.fire({
        title: '✅ Schedule Loaded',
        html: `
          <div style="text-align: left; padding: 15px;">
            <p><strong>Exam Group:</strong> ${group.name}</p>
            <p><strong>Term:</strong> ${this.getTermYearLabel(group.termYear || '')}</p>
            <p><strong>Exams:</strong> ${this.generatedSchedule.length}</p>
            <br>
            <p style="color: #10b981;">✅ Loaded saved schedule from localStorage</p>
          </div>
        `,
        type: 'success',
        confirmButtonText: 'View Schedule',
        showCancelButton: true,
        cancelButtonText: 'Close',
        confirmButtonColor: '#0d6efd',
        cancelButtonColor: '#f44336',
      }).then((result) => {
        if (result.value) {
          // Prepare data before navigating
          this.generateSimpleScheduleData();
          this.buildDeptProgramMapping();
          
          // Reset filters
          this.selectedCourse = 'ALL';
          this.selectedYearLevel = 'ALL';
          this.selectedDepartment = 'ALL';
          this.selectedDay = 'ALL';
          this.searchTerm = '';
          
          // Navigate to schedule view
          setTimeout(() => {
            this.currentStep = 'simpleschedule';
            this.cdr.detectChanges();
          }, 100);
        }
      });
      
      this.cdr.detectChanges();
      return; // Exit early - don't show the "selected" toast
    }
  }

  this.showToast('Success', `Exam group "${group.name}" selected`);
  
  const savedMapping = this.sharedData.getStudentMappingForGroup(
    group.name, 
    group.termYear || ''
  );
  if (savedMapping) {
    console.log(`📂 Found saved mapping for ${group.name}`);
  }

  this.cdr.detectChanges();
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
    data: { 
      group, 
      mode: 'edit',
      activeTermYear: group.termYear || this.global.syear // Use group's term or active config
    }
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
          confirmButtonText: 'Regenerate Now',
          cancelButtonText: 'Keep Old Schedule',
          confirmButtonColor: '#10b981',
          cancelButtonColor: '#f44336'
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

  duplicateGroup(group: ExamGroup) {
  // Open dialog to get new name and optionally new dates
  Swal.fire({
    title: 'Duplicate Exam Group',
    html: `
      <div style="text-align: left; padding: 15px;">
        <p style="margin-bottom: 10px;"><strong>Source:</strong> ${group.name}</p>
        <p style="margin-bottom: 15px; color: #6b7280;">Enter a new name for the duplicated exam group:</p>
        <input id="duplicate-name" class="swal2-input" placeholder="e.g., ${group.name} - Copy" style="margin-top: 0;">
        
        <div style="margin-top: 20px;">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="copy-dates" checked style="margin-right: 8px;">
            <span>Copy exam dates from original</span>
          </label>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '📋 Duplicate',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#3b82f6',
    cancelButtonColor: '#6b7280',
    preConfirm: () => {
      const nameInput = document.getElementById('duplicate-name') as HTMLInputElement;
      const copyDatesCheckbox = document.getElementById('copy-dates') as HTMLInputElement;
      
      const newName = nameInput.value.trim();
      
      if (!newName) {
        Swal.showValidationMessage('Please enter a name');
        return false;
      }
      
      // Check if name already exists
      const exists = this.savedExamGroups.some(g => 
        g.name.toLowerCase() === newName.toLowerCase()
      );
      
      if (exists) {
        Swal.showValidationMessage('An exam group with this name already exists');
        return false;
      }
      
      return {
        name: newName,
        copyDates: copyDatesCheckbox.checked
      };
    }
  }).then((result) => {
    if (result.value) {
      this.executeDuplication(group, result.value.name, result.value.copyDates);
    }
  });
}

private executeDuplication(sourceGroup: ExamGroup, newName: string, copyDates: boolean) {
  // Create duplicated group
  const duplicatedGroup: ExamGroup = {
    name: newName,
    termYear: sourceGroup.termYear,
    days: copyDates 
      ? sourceGroup.days.map(day => ({
          date: day.date ? new Date(day.date) : null,
          am: day.am,
          pm: day.pm
        }))
      : sourceGroup.days.map(day => ({
          date: null,
          am: day.am,
          pm: day.pm
        }))
  };
  
  // Add to saved groups
  this.savedExamGroups.push(duplicatedGroup);
  localStorage.setItem('examGroups', JSON.stringify(this.savedExamGroups));
  
  // Reload groups
  this.loadSavedExamGroups();
  
  // Show success message
  const message = copyDates 
    ? `Duplicated "${sourceGroup.name}" as "${newName}" with same dates`
    : `Duplicated "${sourceGroup.name}" as "${newName}" (dates need to be set)`;
  
  this.showToast('Success', message, 'success');
  
  // Ask if user wants to edit dates (if they didn't copy)
  if (!copyDates) {
    setTimeout(() => {
      Swal.fire({
        title: 'Set Exam Dates?',
        text: `Would you like to set the exam dates for "${newName}" now?`,
        type: 'question',
        showCancelButton: true,
        confirmButtonText: '📅 Set Dates',
        cancelButtonText: 'Later',
        confirmButtonColor: '#10b981'
      }).then((response) => {
        if (response.value) {
          this.editGroup(duplicatedGroup);
        }
      });
    }, 500);
  }
  
  this.cdr.detectChanges();
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
    title: 'Generating Exam Schedule',
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

    // Small delay to ensure UI updates
    await new Promise(resolve => setTimeout(resolve, 100));

   const numDays = this.examDates.filter(d => d).length;
   const startTime = Date.now();

   const dayConfigs = this.selectedExamGroup!.days.map(day => ({
  am: day.am,
  pm: day.pm
}));

this.generatedSchedule = algorithmGenerateSchedule(
  this.exams,
  this.rooms,
  numDays,
  dayConfigs
);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const stats = this.calculateScheduleStats();

    Swal.close();

    
    
    // ✅ CRITICAL: Prepare data BEFORE showing dialog
    console.log('📋 Preparing schedule data...');
    this.generateSimpleScheduleData();
    this.buildDeptProgramMapping();
    
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
      title: 'Schedule Generated Successfully!',
      html: `
        </div>
      `,
      type: 'success',  // ✅ Angular 8 uses 'type' not 'icon'
      showCancelButton: true,
      confirmButtonText: 'View Schedule',
      cancelButtonText: '✖ Close',
      confirmButtonColor: '#0d6efd',
      cancelButtonColor: '#dc3545',
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
  this.detectUnscheduledExams();

// ✅ Initialize default proctors for all exams
this.generatedSchedule.forEach(exam => {
  if (!exam.PROCTOR || exam.PROCTOR === '') {
    exam.PROCTOR = exam.INSTRUCTOR; // Default to instructor
  }
  if (exam.HAS_CONFLICT === undefined) {
    exam.HAS_CONFLICT = false;
  }
});
}



getSubjectCodeCount(subjectId: string): number {
  if (!subjectId) return 0;
  
  return this.generatedSchedule.filter(exam => 
    exam.SUBJECT_ID === subjectId
  ).length;
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


buildDeptProgramMapping() {
  console.log('🔗 Building department-program mapping...');
  
  this.deptProgramMap.clear();
  
  this.generatedSchedule.forEach(exam => {
    const dept = exam.DEPT ? exam.DEPT.toUpperCase().trim() : '';
    const course = exam.COURSE ? exam.COURSE.trim() : '';
    
    if (dept && course) {
      if (!this.deptProgramMap.has(dept)) {
        this.deptProgramMap.set(dept, new Set());
      }
      this.deptProgramMap.get(dept)!.add(course);
    }
  });
  
  console.log('✅ Department-Program mapping built:');
  this.deptProgramMap.forEach((programs, dept) => {
    console.log(`  ${dept}: ${Array.from(programs).join(', ')}`);
  });
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
    'SACE': '#d99594',    // Red
    'SABH': '#FFFF00',    // Yellow
    'SECAP': '#00b0f0',   // Blue
    'SHAS': '#92d050'     // Green
  };
  return dept ? colors[dept.toUpperCase()] || '#6b7280' : '#6b7280';
}

goToStep(step: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' | 'simpleschedule' | 'roomgrid' | 'studentmapping' | 'proctor'): void {
  console.log('🔄 Navigating to step:', step);
  
  // Special handling for proctor view
  if (step === 'proctor') {
    this.viewProctorAssignments();
    return;
  }
  
  // ✅ NEW: When returning to simpleschedule, reset to first tab
  if (step === 'simpleschedule') {
    console.log('Preparing simple schedule with tabs...');
    this.generateSimpleScheduleData();
    this.resetToFirstTab(); // ← This is new!
  }
  
  // Generate data for each view type
  if (step === 'studentmapping') {
    console.log('Generating student mapping data...');
    this.getStudentMappingData();
  } else if (step === 'roomgrid') {
    console.log('Preparing room grid...');
    this.activeDay = this.days[0] || 'Day 1';
  } else if (step === 'coursegrid') {
    console.log('Generating course grid data...');
    this.generateCourseGridData();
    this.activeDay = this.days[0] || 'Day 1';
  } else if (step === 'timetable') {
    console.log('Preparing timetable...');
    this.activeDay = this.days[0] || 'Day 1';
  }
  
  // Regular navigation
  this.currentStep = step;
  
  // Multiple change detection cycles
  this.cdr.detectChanges();
  setTimeout(() => {
    this.cdr.detectChanges();
  }, 50);

  
}

goBackToExamGroups() {
  console.log('🔙 Navigating back to exam groups...');
  
  Swal.fire({
    title: 'Return to Exam Groups?',
    html: `
      <div style="text-align: left; padding: 10px;">
        <p>Go back to exam group selection?</p>
        <p style="color: #6b7280; font-size: 14px; margin-top: 10px;">
          Your current schedule will be preserved.
        </p>
      </div>
    `,
    type: 'question',
    showCancelButton: true,
    confirmButtonText: '← Back to Groups',
    cancelButtonText: 'Stay Here',
    confirmButtonColor: '#3b82f6',
    cancelButtonColor: '#6b7280',
    reverseButtons: true
  }).then((result) => {
    if (result.value) {
      this.currentStep = 'import';
      this.cdr.detectChanges();
      
      this.showToast('Navigation', 'Returned to exam group selection', 'info');
    }
  });
}


/**
 * Quick navigation without confirmation
 */
quickBackToExamGroups() {
  console.log('🔙 Quick back to exam groups...');
  this.currentStep = 'import';
  this.cdr.detectChanges();
}


isCompleteListTabActive(): boolean {
  return this.selectedTabIndex === 3; // Complete List is tab index 3
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
    // ✅ Get active term from GlobalService (active configuration)
    const activeTermYear = this.global.syear; // This comes from active configuration
    
    const dialogRef = this.dialog.open(DatePickerComponent, {
      width: '800px',
      maxHeight: '90vh',
      disableClose: false,
      data: { 
        activeTermYear: activeTermYear,
        mode: 'add'
      }
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
  this.buildDeptProgramMapping();
  
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
  console.log('Selected department:', this.selectedDepartment);
  
  let courses = new Set<string>();
  
  // If a department is selected, only show programs under that department
  if (this.selectedDepartment && this.selectedDepartment !== 'ALL') {
    const deptPrograms = this.deptProgramMap.get(this.selectedDepartment);
    if (deptPrograms) {
      courses = deptPrograms;
      console.log(`✅ Filtered to ${courses.size} programs for ${this.selectedDepartment}`);
    } else {
      console.warn(`⚠️ No programs found for department: ${this.selectedDepartment}`);
    }
  } else {
    // Show all programs
    this.generatedSchedule.forEach(exam => {
      if (exam.COURSE) courses.add(exam.COURSE);
    });
    console.log(`✅ Showing all ${courses.size} programs`);
  }
  
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
  console.log('🔄 Filter changed');
  console.log('  Department:', this.selectedDepartment);
  console.log('  Course:', this.selectedCourse);
  
  // If department filter changed and current course is not valid for this department
  if (this.selectedDepartment && this.selectedDepartment !== 'ALL') {
    const deptPrograms = this.deptProgramMap.get(this.selectedDepartment);
    
    if (deptPrograms && this.selectedCourse !== 'ALL') {
      // Check if selected course belongs to selected department
      if (!deptPrograms.has(this.selectedCourse)) {
        console.log(`⚠️ Resetting course filter - ${this.selectedCourse} not in ${this.selectedDepartment}`);
        this.selectedCourse = 'ALL';
      }
    }
  }
  
  this.updateFilteredSchedule();
}



onDepartmentFilterChange() {
  console.log('🏢 Department filter changed to:', this.selectedDepartment);
  
  // If department changed, reset course to ALL
  // The UI will automatically update to show only courses for that department
  if (this.selectedDepartment && this.selectedDepartment !== 'ALL') {
    const deptPrograms = this.deptProgramMap.get(this.selectedDepartment);
    
    if (deptPrograms && this.selectedCourse !== 'ALL') {
      // Check if current selected course belongs to new department
      if (!deptPrograms.has(this.selectedCourse)) {
        console.log(`🔄 Resetting course to ALL (${this.selectedCourse} not in ${this.selectedDepartment})`);
        this.selectedCourse = 'ALL';
      }
    }
  }
  
  // Trigger the standard filter change
  this.onFilterChange();
  
  // Force UI update to refresh dropdown options
  this.cdr.detectChanges();
}


getDayName(day: string): string {
  // Map Day 1, Day 2, Day 3 to actual exam dates
  const dayIndex = this.days.indexOf(day);
  
  if (dayIndex === -1 || dayIndex >= this.examDates.length) {
    return day;
  }
  
  const examDate = this.examDates[dayIndex];
  
  if (!examDate) {
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
  return `${dayName}, ${formattedDate}`;
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

getDeptGradient(dept: string): string {
  const colors: { [key: string]: string } = {
    'SACE': 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    'SABH': 'linear-gradient(135deg, #facc15 0%, #eab308 100%)',
    'SECAP': 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    'SHAS': 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
    'SBCD': 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
    'SED': 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
    'SMATE': 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    'SNAMS': 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)'
  };
  
  return colors[dept] || 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
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

// ===================================================================
// ✅ PROCTOR ASSIGNMENT METHODS - PART 1
// Add these methods to your ExamSchedulerComponent class
// ===================================================================

initializeInstructorData() {
  console.log('📚 Initializing instructor data...');
  
  this.instructorSubjects.clear();
  this.instructorDepartments.clear();
  
  // Build instructor metadata from all exams
  this.exams.forEach(exam => {
    const instructor = exam.instructor ? exam.instructor.toUpperCase().trim() : "";
    const subject = exam.subjectId ? exam.subjectId.toUpperCase().trim() : "";
    const dept = exam.dept ? exam.dept.toUpperCase().trim() : "";
    
    if (instructor) {
      // Track subjects taught by each instructor
      if (!this.instructorSubjects.has(instructor)) {
        this.instructorSubjects.set(instructor, new Set());
      }
      if (subject) {
        this.instructorSubjects.get(instructor)!.add(subject);
      }
      
      // Track instructor's department
      if (dept && !this.instructorDepartments.has(instructor)) {
        this.instructorDepartments.set(instructor, dept);
      }
    }
  });
  
  console.log(`✅ Loaded ${this.instructorSubjects.size} instructors`);
}

// 2. Detect and resolve proctor conflicts
detectAndResolveProctorConflicts() {
  console.log('🔍 Detecting proctor conflicts...');
  
  const examsByDaySlot: { [key: string]: ScheduledExam[] } = {};
  
  // Group exams by day and time slot
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.DAY}|${exam.SLOT}`;
    if (!examsByDaySlot[key]) {
      examsByDaySlot[key] = [];
    }
    examsByDaySlot[key].push(exam);
  });

  let totalConflicts = 0;

  // Check each time slot for conflicts
  Object.entries(examsByDaySlot).forEach(([key, examsInSlot]) => {
    const proctorCount: { [proctor: string]: ScheduledExam[] } = {};
    
    // Group exams by proctor
    examsInSlot.forEach(exam => {
      const proctor = (exam.PROCTOR || exam.INSTRUCTOR || '').toUpperCase().trim();
      if (proctor) {
        if (!proctorCount[proctor]) {
          proctorCount[proctor] = [];
        }
        proctorCount[proctor].push(exam);
      }
    });

    // Resolve conflicts (proctor assigned to multiple exams)
    Object.entries(proctorCount).forEach(([proctor, conflictedExams]) => {
      if (conflictedExams.length > 1) {
        console.log(`⚠️ Conflict: ${proctor} → ${conflictedExams.length} exams at ${key}`);
        totalConflicts += conflictedExams.length - 1;
        
        // Prioritize instructor's own class
        const ownClass = conflictedExams.find(e => 
          e.INSTRUCTOR.toUpperCase().trim() === proctor
        );
        
        if (ownClass) {
          ownClass.PROCTOR = ownClass.INSTRUCTOR;
          ownClass.HAS_CONFLICT = false;
        }
        
        // Find substitutes for other exams
        conflictedExams.forEach(exam => {
          if (exam !== ownClass) {
            const substitute = this.findSubstituteProctor(exam, key);
            
            if (substitute) {
              exam.PROCTOR = substitute;
              exam.HAS_CONFLICT = false;
              console.log(`✅ Substitute: ${substitute} → ${exam.CODE}`);
            } else {
              exam.HAS_CONFLICT = true;
              console.warn(`❌ No substitute for ${exam.CODE}`);
            }
          }
        });
      } else {
        conflictedExams[0].HAS_CONFLICT = false;
      }
    });
  });
  
  console.log(`Total conflicts resolved: ${totalConflicts}`);
}

// 3. Find substitute proctor for conflicted exam
findSubstituteProctor(exam: ScheduledExam, daySlotKey: string): string | null {
  const [day, slot] = daySlotKey.split('|');
  
  // Get all proctors already assigned in this slot
  const takenProctors = new Set(
    this.generatedSchedule
      .filter(e => e.DAY === day && e.SLOT === slot && e.PROCTOR)
      .map(e => e.PROCTOR ? e.PROCTOR.toUpperCase().trim() : '')
  );

  // Get all unique instructors
  const allProctors = Array.from(new Set(
    this.generatedSchedule.map(e => e.INSTRUCTOR.toUpperCase().trim())
  ));
  
  // Find first available proctor
  const substitute = allProctors.find(p => !takenProctors.has(p));
  return substitute || null;
}

// 4. Pre-compute all proctor suggestions (with chunking)
async precomputeAllProctorSuggestions() {
  console.log('🔄 Pre-computing proctor suggestions...');
  console.time('precompute-suggestions');
  
  this.proctorSuggestionsMap.clear();
  this.allProctorsMap.clear();
  this.processingCancelled = false;
  
  // Get all unique instructors
  const allInstructors = Array.from(
    new Set(
      this.generatedSchedule
        .map(e => e.INSTRUCTOR ? e.INSTRUCTOR.toUpperCase().trim() : "")
        .filter(i => i)
    )
  );

  const CHUNK_SIZE = 25; // Process 25 exams per chunk
  const totalExams = this.generatedSchedule.length;
  const chunks = Math.ceil(totalExams / CHUNK_SIZE);
  
  // Show progress dialog
  Swal.fire({
  title: ' Loading Proctor View',
  html: `
    <div style="text-align: center;">
      <p>Processing exams...</p>
      <div style="margin: 20px 0;">
        <div style="background: #e5e7eb; height: 20px; border-radius: 10px; overflow: hidden;">
        </div>
      </div>
    </div>
  `,
  allowOutsideClick: false,
  showConfirmButton: false,
  onOpen: () => {
    Swal.showLoading();
  }
});
  
  // Process in chunks with async breaks
  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
    if (this.processingCancelled) {
      console.log('Processing cancelled');
      break;
    }
    
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalExams);
    const chunk = this.generatedSchedule.slice(start, end);
    
    // Process chunk synchronously (fast)
    this.processProctorChunk(chunk, allInstructors);
    
    // Update progress bar
    const progress = Math.round((end / totalExams) * 100);
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressText) progressText.textContent = `${end} / ${totalExams} exams`;
    
    // Allow UI to update (real async break)
    if (chunkIndex < chunks - 1) {
      await this.sleep(10); // 10ms break between chunks
    }
  }
  
  Swal.close();
  console.timeEnd('precompute-suggestions');
  console.log(`✅ Pre-computed suggestions for ${this.proctorSuggestionsMap.size} exams`);
}

// 5. Process a chunk of exams (helper for precompute)
private processProctorChunk(chunk: ScheduledExam[], allInstructors: string[]) {
  chunk.forEach(exam => {
    const key = exam.CODE;
    const examSubject = exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().trim() : "";
    const examDept = exam.DEPT ? exam.DEPT.toUpperCase().trim() : "";
    const currentProctor = exam.PROCTOR ? exam.PROCTOR.toUpperCase().trim() : "";

    const sameSubject: string[] = [];
    const sameDept: string[] = [];
    const available: string[] = [];
    const allAvailable: string[] = [];
    
    // Pre-filter busy proctors for this slot
    const busyProctors = new Set<string>();
    this.generatedSchedule.forEach(e => {
      if (e !== exam && 
          e.DAY === exam.DAY && 
          e.SLOT === exam.SLOT && 
          e.PROCTOR) {
        const p = e.PROCTOR.toUpperCase().trim();
        if (p !== currentProctor) {
          busyProctors.add(p);
        }
      }
    });
    
    // Categorize available instructors
    allInstructors.forEach(instructor => {
      if (busyProctors.has(instructor)) return;
      
      allAvailable.push(instructor);
      
      const instructorDept = this.instructorDepartments.get(instructor) || '';
      const instructorSubjects = this.instructorSubjects.get(instructor) || new Set();
      
      if (examSubject && instructorSubjects.has(examSubject)) {
        sameSubject.push(instructor);
      } else if (examDept && instructorDept === examDept) {
        sameDept.push(instructor);
      } else {
        available.push(instructor);
      }
    });
    
    // Store results
    this.proctorSuggestionsMap.set(key, {
      sameSubject: sameSubject.sort(),
      sameDept: sameDept.sort(),
      available: available.sort()
    });
    
    this.allProctorsMap.set(key, 
      allAvailable.length > 0 ? allAvailable.sort() : ['No available instructor']
    );
  });
}

// 6. Helper: Sleep for async processing
private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// 7. Get smart proctor suggestions (cached)
getSmartProctorSuggestions(exam: ScheduledExam): ProctorSuggestion {
  const cached = this.proctorSuggestionsMap.get(exam.CODE);
  return cached || { sameSubject: [], sameDept: [], available: [] };
}

// 8. Get all available proctors for dropdown (cached)
getAllProctorsForDropdown(exam: ScheduledExam): string[] {
  const cached = this.allProctorsMap.get(exam.CODE);
  return cached || ['No available instructor'];
}

// 9. Get match type for proctor (with icon)
getProctorMatchType(exam: ScheduledExam, proctor: string): ProctorMatchType {
  const details = this.getProctorMatchDetails(exam, proctor);
  
  if (details.matchesSubject && details.matchesDept) {
    return { 
      type: 'same-subject', 
      label: 'Perfect Match', 
      icon: '🎯',
      details: `Same subject (${exam.SUBJECT_ID}) & dept (${exam.DEPT})`
    };
  } else if (details.matchesSubject) {
    return { 
      type: 'same-subject', 
      label: 'Same Subject', 
      icon: '🎯',
      details: `Teaches ${exam.SUBJECT_ID}`
    };
  } else if (details.matchesDept) {
    return { 
      type: 'same-dept', 
      label: 'Same Dept', 
      icon: '🏛️',
      details: `${details.proctorDept} department`
    };
  } else {
    return { 
      type: 'available', 
      label: 'Available', 
      icon: '✓',
      details: `From ${details.proctorDept} dept`
    };
  }
}

// 10. Get proctor match details
getProctorMatchDetails(exam: ScheduledExam, proctor: string): ProctorMatchDetails {
  const proctorUpper = proctor.toUpperCase().trim();
  const examSubject = exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().trim() : "";
  const examDept = exam.DEPT ? exam.DEPT.toUpperCase().trim() : "";
  
  const proctorSubjects = this.instructorSubjects.get(proctorUpper) || new Set();
  const proctorDept = this.instructorDepartments.get(proctorUpper) || 'Unknown';
  
  const matchesSubject = examSubject && proctorSubjects.has(examSubject);
  const matchesDept = examDept && proctorDept.toUpperCase() === examDept;
  
  const subjectsInCommon: string[] = [];
  if (proctorSubjects.size > 0) {
    proctorSubjects.forEach(subject => {
      subjectsInCommon.push(subject);
    });
  }
  
  return {
    matchesSubject,
    matchesDept,
    subjectsInCommon: subjectsInCommon.sort(),
    proctorDept
  };
}

// 11. Assign proctor to exam
assignProctorSmart(exam: ScheduledExam, proctor: string) {
  if (!proctor || proctor === 'No available instructor' || proctor === '') {
    this.showToast('Error', 'Please select a valid proctor', 'destructive');
    return;
  }
  
  const previousProctor = exam.PROCTOR;
  const proctorUpper = proctor.toUpperCase().trim();
  
  // Check for conflicts
  const conflict = this.generatedSchedule.find(e =>
    e !== exam &&
    e.DAY === exam.DAY &&
    e.SLOT === exam.SLOT &&
    e.PROCTOR &&
    e.PROCTOR.toUpperCase().trim() === proctorUpper
  );
  
  if (conflict) {
    Swal.fire({
      title: 'Conflict Warning',
      type: 'warning',
      html: `
        <div style="text-align: left; padding: 15px;">
          <p style="margin-bottom: 15px;"><strong>${proctor}</strong> is already proctoring:</p>
          <div style="background: #fee2e2; padding: 12px; border-radius: 8px; border-left: 4px solid #ef4444;">
            <p style="margin: 0;"><strong>${conflict.CODE}</strong> - ${conflict.DESCRIPTIVE_TITLE}</p>
            <p style="margin: 8px 0 0 0; font-size: 14px; color: #6b7280;">
              ${conflict.COURSE} | Room ${conflict.ROOM}
            </p>
          </div>
          <p style="margin-top: 15px; color: #ef4444; font-weight: 600;">Assign anyway?</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Yes, assign anyway',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ef4444'
    }).then((result) => {
      if (result.value) {
        this.executeProctorAssignmentWithoutSave(exam, proctor); // ✅ CHANGED: No auto-save
      } else {
        exam.PROCTOR = previousProctor;
        this.cdr.detectChanges();
      }
    });
  } else {
    this.executeProctorAssignmentWithoutSave(exam, proctor); // ✅ CHANGED: No auto-save
  }
}


// ✅ NEW: Execute proctor assignment WITHOUT auto-save
private executeProctorAssignmentWithoutSave(exam: ScheduledExam, proctor: string) {
  exam.PROCTOR = proctor;
  exam.HAS_CONFLICT = false;
  
  // Only update suggestions for affected time slot (much faster)
  this.updateSuggestionsForTimeSlot(exam.DAY, exam.SLOT);
  
  const proctorSubjects = this.getInstructorSubjects(proctor);
  const examSubject = exam.SUBJECT_ID || '';
  
  let matchIcon = '✓';
  if (proctorSubjects.includes(examSubject)) {
    matchIcon = '🎯';
  } else if (this.getInstructorDepartment(proctor) === exam.DEPT) {
    matchIcon = '🏛️';
  }
  
  this.showToast('Proctor Assigned', `${matchIcon} ${proctor} → ${exam.CODE}`, 'success');
  // ✅ REMOVED: this.saveCurrentSchedule(); - No auto-save!
  this.cdr.detectChanges();
}

// 12. Execute proctor assignment (helper)
private executeProctorAssignment(exam: ScheduledExam, proctor: string) {
  exam.PROCTOR = proctor;
  exam.HAS_CONFLICT = false;
  
  // Only update suggestions for affected time slot (much faster)
  this.updateSuggestionsForTimeSlot(exam.DAY, exam.SLOT);
  
  const proctorSubjects = this.getInstructorSubjects(proctor);
  const examSubject = exam.SUBJECT_ID || '';
  
  let matchIcon = '✓';
  if (proctorSubjects.includes(examSubject)) {
    matchIcon = '🎯';
  } else if (this.getInstructorDepartment(proctor) === exam.DEPT) {
    matchIcon = '🏛️';
  }
  
  this.showToast('Proctor Assigned', `${matchIcon} ${proctor} → ${exam.CODE}`, 'success');
  this.saveCurrentSchedule(); // Auto-save
  this.cdr.detectChanges();
}

// 13. Update suggestions for specific time slot (optimized)
private updateSuggestionsForTimeSlot(day: string, slot: string) {
  const affectedExams = this.generatedSchedule.filter(e => 
    e.DAY === day && e.SLOT === slot
  );
  
  const allInstructors = Array.from(
    new Set(
      this.generatedSchedule
        .map(e => e.INSTRUCTOR ? e.INSTRUCTOR.toUpperCase().trim() : "")
        .filter(i => i)
    )
  );

  // Process affected exams only
  this.processProctorChunk(affectedExams, allInstructors);
}

// 14. Auto-assign all proctors intelligently
async autoAssignAllProctors() {
  console.log('=== Auto-Assigning All Proctors ===');
  
  if (!this.generatedSchedule || this.generatedSchedule.length === 0) {
    this.showToast('Error', 'No exams to assign', 'destructive');
    return;
  }

  if (!this.instructorSubjects || this.instructorSubjects.size === 0) {
    this.initializeInstructorData();
  }

  Swal.fire({
    title: '⚡ Auto-Assigning Proctors',
    text: 'Please wait...',
    allowOutsideClick: false,
    backdrop: true, // ✅ ADD: Dark background
    onOpen: () => {
      Swal.showLoading();
    }
  });

  await this.sleep(100);

  let stats: ProctorStatistics = {
    total: this.generatedSchedule.length,
    assigned: 0,
    conflicts: 0,
    sameSubject: 0,
    sameDept: 0,
    perfect: 0
  };
  
  // Reset all proctors
  this.generatedSchedule.forEach(exam => {
    exam.PROCTOR = '';
    exam.HAS_CONFLICT = false;
  });

  // Group by day+slot
  const examsBySlot: { [key: string]: ScheduledExam[] } = {};
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.DAY}|${exam.SLOT}`;
    if (!examsBySlot[key]) examsBySlot[key] = [];
    examsBySlot[key].push(exam);
  });

  const allInstructors = Array.from(
    new Set(
      this.generatedSchedule
        .map(e => e.INSTRUCTOR ? e.INSTRUCTOR.toUpperCase().trim() : "")
        .filter(i => i)
    )
  );

  // Process each time slot
  Object.values(examsBySlot).forEach(examsInSlot => {
    const busyProctors = new Set<string>();

    examsInSlot.forEach(exam => {
      const examSubject = exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().trim() : "";
      const examDept = exam.DEPT ? exam.DEPT.toUpperCase().trim() : "";
      const instructorUpper = exam.INSTRUCTOR ? exam.INSTRUCTOR.toUpperCase().trim() : "";

      // Prioritize instructor's own class
      if (!busyProctors.has(instructorUpper)) {
        exam.PROCTOR = exam.INSTRUCTOR;
        busyProctors.add(instructorUpper);
        stats.assigned++;
        stats.perfect++;
        return;
      }

      // Find best substitute
      let bestProctor = null;
      let matchType = '';
      
      for (const instructor of allInstructors) {
        if (busyProctors.has(instructor)) continue;
        
        const instructorDept = this.instructorDepartments.get(instructor) || '';
        const instructorSubjects = this.instructorSubjects.get(instructor) || new Set();
        
        // Perfect match: same subject + same dept
        if (examSubject && instructorSubjects.has(examSubject) && instructorDept === examDept) {
          bestProctor = instructor;
          matchType = 'perfect';
          break;
        }
        
        // Good match: same subject
        if (!bestProctor && examSubject && instructorSubjects.has(examSubject)) {
          bestProctor = instructor;
          matchType = 'subject';
        }
        
        // OK match: same dept
        if (!bestProctor && examDept && instructorDept === examDept) {
          bestProctor = instructor;
          matchType = 'dept';
        }
        
        // Fallback: any available
        if (!bestProctor) {
          bestProctor = instructor;
          matchType = 'available';
        }
      }
      
      if (bestProctor) {
        exam.PROCTOR = bestProctor;
        busyProctors.add(bestProctor.toUpperCase().trim());
        stats.assigned++;
        if (matchType === 'perfect') stats.perfect++;
        else if (matchType === 'subject') stats.sameSubject++;
        else if (matchType === 'dept') stats.sameDept++;
      } else {
        exam.PROCTOR = 'TBD';
        exam.HAS_CONFLICT = true;
        stats.conflicts++;
      }
    });
  });

  // Refresh suggestions
  await this.precomputeAllProctorSuggestions();
  this.computeFilteredProctorList();

  Swal.close();

  // ✅ FIXED: Show correct success message
  const message = `
    <div style="text-align: left; padding: 10px;">
      <p><strong>✅ Auto-Assignment Complete!</strong></p>
      <ul style="margin: 10px 0; padding-left: 20px;">
        <li>Total Assigned: <strong>${stats.assigned}</strong> / ${stats.total}</li>
        <li>🎯 Perfect Match: <strong>${stats.perfect}</strong></li>
        <li>📚 Same Subject: <strong>${stats.sameSubject}</strong></li>
        <li>🏛️ Same Dept: <strong>${stats.sameDept}</strong></li>
        ${stats.conflicts > 0 ? `<li>⚠️ Needs Manual: <strong>${stats.conflicts}</strong></li>` : ''}
      </ul>
      <p style="margin-top: 15px; padding: 10px; background: #e3f2fd; border-radius: 4px; font-size: 13px;">
        💡 <strong>Tip:</strong> Don't forget to click "Save Schedule" when you're done!
      </p>
    </div>
  `;

  Swal.fire({
    title: 'Proctors Assigned!',
    html: message,
    type: 'success',
    confirmButtonText: 'Got it!'
  });

  // ✅ REMOVED: this.saveCurrentSchedule(); - Don't auto-save!
  this.cdr.detectChanges();
}

// 15. Reset all proctors
async resetAllProctors() {
  const result = await Swal.fire({
    title: 'Reset All Proctors?',
    text: 'This will clear all proctor assignments.',
    type: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'Yes, reset all',
    cancelButtonText: 'Cancel'
  });
  
  if (result.value) {
    this.generatedSchedule.forEach(exam => {
      exam.PROCTOR = '';
      exam.HAS_CONFLICT = false;
    });
    
    await this.precomputeAllProctorSuggestions();
    this.computeFilteredProctorList();
    
    this.showToast('Reset Complete', 'All proctor assignments cleared');
    this.saveCurrentSchedule();
    this.cdr.detectChanges();
  }
}

computeFilteredProctorList() {
  // Clear existing timer
  if (this.filterDebounceTimer) {
    clearTimeout(this.filterDebounceTimer);
  }
  
  // Debounce filtering by 300ms
  this.filterDebounceTimer = setTimeout(() => {
    this.executeFiltering();
  }, 300);
  this.cdr.detectChanges();
}

// 17. Execute filtering (helper)
private executeFiltering() {
  if (!this.generatedSchedule || this.generatedSchedule.length === 0) {
    this.filteredProctorList = [];
    return;
  }
  
  console.time('filter-exams');
  
  let filtered = this.generatedSchedule;
  
  // Search filter
  const query = (this.proctorSearchQuery || '').toLowerCase().trim();
  if (query) {
    filtered = filtered.filter(exam => {
      const searchable = [
        exam.CODE,
        exam.DESCRIPTIVE_TITLE,
        exam.COURSE,
        exam.INSTRUCTOR,
        exam.PROCTOR,
        exam.ROOM,
        exam.DAY,
        exam.SUBJECT_ID,
        exam.DEPT
      ]
        .map(s => (s ? s.toString().toLowerCase() : ""))
        .join(" ");
      
      return searchable.includes(query);
    });
  }
  
  // Department filter
  if (this.selectedProctorDept) {
    const deptQuery = this.selectedProctorDept.toUpperCase().trim();
    filtered = filtered.filter(exam =>
      exam.DEPT ? exam.DEPT.toUpperCase().trim() === deptQuery : false
    );
  }
  
  // Subject filter
  if (this.selectedProctorSubject) {
    const subjectQuery = this.selectedProctorSubject.toUpperCase();
    filtered = filtered.filter(exam =>
      exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().includes(subjectQuery) : false
    );
  }
  
  this.filteredProctorList = filtered;
  console.timeEnd('filter-exams');
  console.log(`Filtered: ${filtered.length} / ${this.generatedSchedule.length} exams`);
}

// 18. Get filtered list (getter)
get filteredProctorListEnhanced(): ScheduledExam[] {
  // ✅ Defensive: If filteredProctorList is empty but schedule has data, return schedule
  if ((!this.filteredProctorList || this.filteredProctorList.length === 0) && 
      this.generatedSchedule && this.generatedSchedule.length > 0) {
    console.warn('⚠️ filteredProctorList is empty, returning generatedSchedule');
    return this.generatedSchedule;
  }
  return this.filteredProctorList || [];
}

// 19. Clear all filters
clearProctorFilters() {
  this.proctorSearchQuery = '';
  this.selectedProctorDept = '';
  this.selectedProctorSubject = '';
  this.computeFilteredProctorList();
}

// 20. Apply filters (called from UI)
applyProctorFilters() {
  this.computeFilteredProctorList();
}

// 21. Get instructor subjects
getInstructorSubjects(instructor: string): string[] {
  if (!instructor) return [];
  const instructorUpper = instructor.toUpperCase().trim();
  const subjects = this.instructorSubjects.get(instructorUpper);
  return subjects ? Array.from(subjects).sort() : [];
}

// 22. Get instructor department
getInstructorDepartment(instructor: string): string {
  if (!instructor) return 'Unknown';
  const instructorUpper = instructor.toUpperCase().trim();
  return this.instructorDepartments.get(instructorUpper) || 'Unknown';
}

// 23. Get unique instructor departments
get uniqueInstructorDepartments(): string[] {
  return Array.from(new Set(Array.from(this.instructorDepartments.values()))).sort();
}

// 24. Get unique subjects taught
get uniqueSubjectsTaught(): string[] {
  const allSubjects = new Set<string>();
  this.instructorSubjects.forEach(subjects => {
    subjects.forEach(subject => allSubjects.add(subject));
  });
  return Array.from(allSubjects).sort();
}

// 25. Statistics getters
get totalExams(): number {
  return this.generatedSchedule ? this.generatedSchedule.length : 0;
}

get assignedExams(): number {
  if (!this.generatedSchedule) return 0;
  return this.generatedSchedule.filter(e => 
    e.PROCTOR && e.PROCTOR !== 'TBD' && !e.HAS_CONFLICT
  ).length;
}

get conflictExams(): number {
  if (!this.generatedSchedule) return 0;
  return this.generatedSchedule.filter(e => 
    e.HAS_CONFLICT || !e.PROCTOR || e.PROCTOR === 'TBD'
  ).length;
}

get totalProctors(): number {
  const proctors = new Set<string>();
  if (this.generatedSchedule) {
    this.generatedSchedule.forEach(e => {
      if (e.PROCTOR && e.PROCTOR !== 'TBD') {
        proctors.add(e.PROCTOR.toUpperCase().trim());
      }
    });
  }
  return proctors.size;
}

// 26. Main entry point: View proctor assignments
async viewProctorAssignments() {
  console.log('=== Initializing Proctor View ===');
  console.time('total-init');
  
  if (!this.generatedSchedule || this.generatedSchedule.length === 0) {
    this.showToast('Error', 'No schedule generated yet', 'destructive');
    return;
  }
  
  // Cancel any ongoing processing
  this.processingCancelled = true;
  await this.sleep(50);
  this.processingCancelled = false;
  
  // Step 1: Initialize instructor data (fast)
  this.initializeInstructorData();
  
  // Step 2: Set default proctors (fast)
  this.generatedSchedule.forEach(exam => {
    if (!exam.PROCTOR || exam.PROCTOR === 'TBD' || exam.PROCTOR === '') {
      exam.PROCTOR = exam.INSTRUCTOR;
    }
    if (exam.HAS_CONFLICT === undefined) {
      exam.HAS_CONFLICT = false;
    }
  });
  
 // Step 3: Pre-compute suggestions (chunked with progress)
  console.log('Step 3: Pre-computing suggestions...');
  await this.precomputeAllProctorSuggestions();
  
  // ✅ FIX: Initialize filteredProctorList IMMEDIATELY with all exams
  console.log('Step 4: Initializing filtered list...');
  this.filteredProctorList = [...this.generatedSchedule];
  console.log(`✅ filteredProctorList has ${this.filteredProctorList.length} exams`);
  
  // ✅ FIX: Reset all filters to ensure everything shows
  this.proctorSearchQuery = '';
  this.selectedProctorDept = '';
  this.selectedProctorSubject = '';
  
  // Close loading dialog
  Swal.close();
  
  // ✅ FIX: Switch to proctor view AFTER data is ready
  console.log('Step 5: Switching to proctor view...');
  this.currentStep = 'proctor';
  
  // ✅ FIX: Force multiple change detection cycles
  this.cdr.detectChanges();
  await this.sleep(50);
  this.cdr.detectChanges();
  await this.sleep(50);
  
  console.timeEnd('total-init');
  console.log('✅ Proctor view ready');
  console.log(`  - ${this.generatedSchedule.length} total exams`);
  console.log(`  - ${this.filteredProctorList.length} displayed`);
  console.log(`  - Current step: ${this.currentStep}`);
  
  // ✅ FIX: Final change detection
  this.cdr.detectChanges();

}

// 27. Download proctor assignments CSV
downloadProctorAssignmentsCSV() {
  if (this.generatedSchedule.length === 0) return;

  const headers = ['Day', 'Time', 'Room', 'Code', 'Subject', 'Course', 'Year', 'Instructor', 'Proctor', 'Has Conflict'];
  const rows = this.generatedSchedule.map(item => [
    item.DAY,
    item.SLOT,
    item.ROOM,
    item.CODE,
    item.DESCRIPTIVE_TITLE,
    item.COURSE,
    item.YEAR_LEVEL,
    item.INSTRUCTOR,
    item.PROCTOR || 'Not Assigned',
    item.HAS_CONFLICT ? 'Yes' : 'No'
  ]);

  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => `"${cell}"`).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const fileName = this.selectedExamGroup 
    ? `${this.selectedExamGroup.name}_Proctor_Assignments.csv`
    : 'Proctor_Assignments.csv';
  saveAs(blob, fileName);
  
  this.showToast('Downloaded', 'Proctor assignments exported successfully');
}

// 28. Cleanup on component destroy
cleanupProctorView() {
  this.processingCancelled = true;
  this.proctorSuggestionsMap.clear();
  this.allProctorsMap.clear();
  this.filteredProctorList = [];
  if (this.filterDebounceTimer) {
    clearTimeout(this.filterDebounceTimer);
  }
  console.log('Proctor view cleanup complete');
}

// 29. Track by function (important for performance)
trackByExamCode(index: number, exam: ScheduledExam): string {
  return `${exam.CODE}_${exam.DAY}_${exam.SLOT}`;
}


// ===================================================================
// ✅ UNSCHEDULED EXAMS METHODS
// Add these methods to your ExamSchedulerComponent class
// ===================================================================

// 1. Detect unscheduled exams (call after generateExamSchedule)
detectUnscheduledExams() {
  const scheduledCodes = new Set(this.generatedSchedule.map(e => e.CODE));
  this.unscheduledExams = this.exams.filter(e => !scheduledCodes.has(e.code));

  if (this.unscheduledExams.length > 0) {
    console.warn('⚠️ Unscheduled exams:', this.unscheduledExams);
    this.showToast(
      'Warning',
      `${this.unscheduledExams.length} exam(s) could not be scheduled.`,
      'warning'
    );
  } else {
    console.log('✅ All exams scheduled');
  }
}

// 2. Toggle unscheduled panel
toggleUnscheduledPanel() {
  this.showUnscheduledPanel = !this.showUnscheduledPanel;
}

// 3. Open unscheduled panel
openUnscheduledPanel() {
  console.log('📂 openUnscheduledPanel called');

  const count = this.unscheduledExams ? this.unscheduledExams.length : 0;
  console.log('Unscheduled exams count:', count);

  if (!this.unscheduledExams || this.unscheduledExams.length === 0) {
    Swal.fire({
      title: '✅ All Exams Scheduled',
      text: 'There are no unscheduled exams.',
      type: 'success'
    });
    return;
  }

  this.showUnscheduledPanel = true;
  this.cdr.detectChanges();

  console.log('✅ Panel opened, showUnscheduledPanel =', this.showUnscheduledPanel);
}

// 4. Edit unscheduled exam
editUnscheduledExam(exam: Exam) {
  console.log('✏️ Editing exam:', exam);
  this.editingUnscheduledExam = exam;
  this.editFormData = {
    code: exam.code,
    subjectId: exam.subjectId,
    title: exam.title,
    course: exam.course,
    yearLevel: exam.yearLevel,
    instructor: exam.instructor,
    dept: exam.dept,
    lec: exam.lec || 0,
    oe: exam.oe || 0,
    version: exam.version || ''
  };
}

// 5. Cancel edit
cancelEditUnscheduledExam() {
  this.editingUnscheduledExam = null;
  this.editFormData = null;
}

// 6. Save edited exam and reschedule it
saveAndRescheduleExam() {
  if (!this.editingUnscheduledExam || !this.editFormData) {
    this.showToast('Error', 'No exam selected', 'destructive');
    return;
  }

  const updatedExam: Exam = {
    code: this.editFormData.code,
    subjectId: this.editFormData.subjectId,
    title: this.editFormData.title,
    course: this.editFormData.course,
    yearLevel: this.editFormData.yearLevel,
    instructor: this.editFormData.instructor,
    dept: this.editFormData.dept,
    lec: this.editFormData.lec || 0,
    oe: this.editFormData.oe || 0,
    version: this.editFormData.version || '',
    studentCount: this.editingUnscheduledExam.studentCount || 0,
    isRegular: this.editingUnscheduledExam.isRegular || true,
    campus: this.editingUnscheduledExam.campus || 'MAIN',
    lectureRoom: this.editingUnscheduledExam.lectureRoom || '',
    lectureBuilding: this.editingUnscheduledExam.lectureBuilding || ''
  };

  // Update in main exams array
  const index = this.exams.findIndex(e => e.code === this.editingUnscheduledExam.code);
  if (index !== -1) {
    this.exams[index] = updatedExam;
  }

  // Remove from unscheduled list
  this.unscheduledExams = this.unscheduledExams.filter(e => e.code !== updatedExam.code);
  
  // Try to schedule it
  this.scheduleUnscheduledExam(updatedExam);

  this.editingUnscheduledExam = null;
  this.editFormData = null;

  this.showToast('Success', `Exam ${updatedExam.code} saved and scheduled`);
  this.saveCurrentSchedule();
}

// 7. Schedule a single unscheduled exam
scheduleUnscheduledExam(exam: Exam) {
  const allRooms = this.rooms.length > 0 ? this.rooms.sort() : ['A', 'C', 'K', 'L', 'M', 'N'];
  const roomsList = allRooms; // You can add filtering here if needed

  const subjectId = exam.subjectId ? exam.subjectId.toUpperCase().trim() : '';
  const title = exam.title ? exam.title.toUpperCase().trim() : '';
  const code = exam.code ? exam.code.toUpperCase().trim() : '';

  // Check if already scheduled
  const alreadyScheduled = this.generatedSchedule.some(
    e => e.CODE === code && e.SUBJECT_ID === subjectId
  );
  if (alreadyScheduled) {
    this.showToast('Warning', `Exam ${code} is already scheduled`, 'warning');
    return;
  }

  let day = '';
  let slot = '';
  let room = '';

  // Find first available slot
  for (const dayOption of this.days) {
    if (day) break;
    
    for (const slotOption of this.timeSlots) {
      // Check if slot has room for more exams
      const slotKey = `${dayOption}-${slotOption}`;
      const examsInSlot = this.generatedSchedule.filter(e => 
        e.DAY === dayOption && e.SLOT === slotOption
      );
      
      const usedRooms = new Set(examsInSlot.map(e => e.ROOM));
      const availableRooms = roomsList.filter(r => !usedRooms.has(r));
      
      if (availableRooms.length > 0) {
        day = dayOption;
        slot = slotOption;
        room = availableRooms[0];
        break;
      }
    }
  }

  if (!day || !slot || !room) {
    console.warn(`⚠️ No available slots for ${code}`);
    this.showToast('Error', `No available slots for ${code}`, 'destructive');
    return;
  }

  // Add to schedule
  this.generatedSchedule.push({
    CODE: exam.code,
    SUBJECT_ID: exam.subjectId,
    DESCRIPTIVE_TITLE: exam.title,
    COURSE: exam.course,
    YEAR_LEVEL: exam.yearLevel,
    INSTRUCTOR: exam.instructor,
    DEPT: exam.dept,
    OE: exam.oe,
    DAY: day,
    SLOT: slot,
    ROOM: room,
    UNITS: exam.lec,
    STUDENT_COUNT: exam.studentCount,
    IS_REGULAR: exam.isRegular,
    LECTURE_ROOM: exam.lectureRoom,
    PROCTOR: exam.instructor || 'TBD',
    HAS_CONFLICT: false
  });

  console.log(`✅ Scheduled ${code} at ${day} ${slot} in ${room}`);
  
  // Regenerate views
  this.generateSimpleScheduleData();
  this.generateCourseGridData();
  
  this.showToast('Success', `${code} scheduled at ${day} ${slot}`);
}

// 8. Delete unscheduled exam
deleteUnscheduledExam(exam: Exam) {
  const confirmed = confirm(`Delete exam ${exam.code} - ${exam.title}?`);
  if (!confirmed) return;

  // Remove from both arrays
  this.exams = this.exams.filter(e => e.code !== exam.code);
  this.unscheduledExams = this.unscheduledExams.filter(e => e.code !== exam.code);

  this.showToast('Deleted', `Exam ${exam.code} deleted`);
  this.saveCurrentSchedule();
}

// 9. Get unscheduled count (for badge)
getUnscheduledCount(): number {
  return this.unscheduledExams ? this.unscheduledExams.length : 0;
}

// 10. Close unscheduled panel
closeUnscheduledPanel() {
  this.showUnscheduledPanel = false;
  this.editingUnscheduledExam = null;
  this.editFormData = null;
}


onTabChange(event: any) {
  console.log('📑 Tab changed to index:', event.index);
  
  this.selectedTabIndex = event.index;
  
  switch(event.index) {
    case 0: // Student Mapping
      console.log('Loading Student Mapping data...');
      this.getStudentMappingData();
      break;
      
    case 1: // Room Grid
      console.log('Loading Room Grid data...');
      if (!this.activeDay || this.activeDay === '') {
        this.activeDay = this.days[0] || 'Day 1';
      }
      break;
      
    case 2: // Proctor Assignment
      console.log('Proctor tab selected - user needs to click button to load');
      break;
      
    case 3: // Complete List
      console.log('Complete List tab selected');
      this.onFilterChange();
      break;
  }
  
  this.cdr.detectChanges();
}


loadProctorViewFromTab() {
  console.log('🔄 Loading proctor view from tab...');
  this.goToStep('proctor');
}


resetToFirstTab() {
  this.selectedTabIndex = 0;
  this.cdr.detectChanges();
}

}