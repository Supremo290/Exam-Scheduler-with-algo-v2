import { Component, Inject, OnInit, Optional } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { SharedDataService } from '../shared-data.service';
import Swal from 'sweetalert2';

interface ExamDay {
  date: Date | null;
  am: boolean;
  pm: boolean;
}

interface ExamGroup {
  name: string;
  days: ExamDay[];
  termYear?: string;
}

@Component({
  selector: 'app-date-picker',
  templateUrl: './date-picker.component.html',
  styleUrls: ['./date-picker.component.scss']
})
export class DatePickerComponent implements OnInit {
  examDays: ExamDay[] = [];
  savedExamGroups: ExamGroup[] = [];
  selectedGroupName: string | null = null;
  newGroupName: string = '';
  examGroupOptions: string[] = ['PRELIM', 'MIDTERM', 'FINAL', 'SUMMER'];
  selectedTermYear: string = ''; // This will now be auto-populated from active config
  termYearOptions: { label: string, value: string }[] = [];

  showEditor = true;
  editingGroup: ExamGroup | null = null;

  maxDays = 5;
  minDate!: Date;
  maxDate!: Date;

  // Display label for the active term (read-only)
  activeTermLabel: string = '';

  constructor(
    private sharedData: SharedDataService,
    @Optional() public dialogRef?: MatDialogRef<DatePickerComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data?: any
  ) {}

  ngOnInit() {
    const currentYear = new Date().getFullYear();
    this.minDate = new Date(currentYear, 0, 1);
    this.maxDate = new Date(2035, 11, 31);

    this.generateTermYearOptions();
    this.loadStoredGroups();
    
    // ✅ NEW: Get active term from data passed by parent component
    if (this.data && this.data.activeTermYear) {
      this.selectedTermYear = this.data.activeTermYear;
      this.activeTermLabel = this.getTermYearLabel(this.data.activeTermYear);
      console.log('📅 Using active term from config:', this.selectedTermYear, '→', this.activeTermLabel);
    }
    
    if (!this.data || this.data.mode !== 'edit') {
      this.sharedData.clearSelectedExamGroup();
      this.sharedData.clearExamDates();
      this.sharedData.clearActiveTerm();
      this.selectedGroupName = null;
    }
    
    if (this.data && this.data.mode === 'edit' && this.data.group) {
      this.editGroup(this.data.group);
    } else {
      this.resetExamDays();
    }
  }

  generateTermYearOptions() {
    const currentYear = new Date().getFullYear();
    const terms = [
      { key: 1, value: '1st Semester' },
      { key: 2, value: '2nd Semester' },
      { key: 3, value: 'Summer' },
    ];

    for (let y = currentYear - 2; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of terms) {
        const label = `${t.value} SY ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.termYearOptions.push({ label, value });
      }
    }
  }

  addDates() {
    this.showEditor = true;
    this.editingGroup = null;
    this.resetExamDays();
    this.newGroupName = '';
    // ✅ CHANGED: Don't clear selectedTermYear - it should remain as active term
    // this.selectedTermYear = '';
  }

  loadStoredGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }

  saveAllGroups() {
    localStorage.setItem('examGroups', JSON.stringify(this.savedExamGroups));
  }

  addDay() {
    if (this.examDays.length < this.maxDays) {
      this.examDays.push({ date: null, am: false, pm: false });
    }
  }

  removeDay(index: number) {
    this.examDays.splice(index, 1);
  }

  resetExamDays() {
    this.examDays = [{ date: null, am: false, pm: false }];
  }

  editGroup(group: ExamGroup) {
    this.editingGroup = group;
    this.showEditor = true;
    this.newGroupName = group.name;
    this.selectedTermYear = group.termYear || '';
    this.activeTermLabel = this.getTermYearLabel(group.termYear || '');
    this.examDays = group.days.map(d => ({
      date: d.date ? new Date(d.date) : null,
      am: d.am,
      pm: d.pm
    }));
  }

  saveGroup() {
    const validDays = this.examDays.filter(d => d.date instanceof Date);

    // ❌ Validation: No valid dates
    if (!validDays.length) {
      Swal.fire({
        title: 'Missing Dates',
        text: 'Please select at least one valid exam date.',
        type: 'warning',
        confirmButtonText: 'OK',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    // ❌ Validation: No group name
    if (!this.newGroupName.trim()) {
      Swal.fire({
        title: 'Missing Group Name',
        text: 'Please enter a name for this exam schedule.',
        type: 'warning',
        confirmButtonText: 'OK',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    // ❌ Validation: No term/year selected (should not happen now, but keep as safety check)
    if (!this.selectedTermYear) {
      Swal.fire({
        title: 'Missing Term & Year',
        text: 'Active configuration is not set. Please set it in the configuration modal first.',
        type: 'warning',
        confirmButtonText: 'OK',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    const updatedGroup: ExamGroup = {
      name: this.newGroupName.trim(),
      days: validDays,
      termYear: this.selectedTermYear
    };

    console.log('💾 Saving group with termYear:', this.selectedTermYear);

    if (this.editingGroup) {
      // EDIT MODE
      const index = this.savedExamGroups.findIndex(g => g.name === this.editingGroup!.name);
      console.log('🔍 Looking for group:', this.editingGroup.name);
      console.log('🔍 Found at index:', index);
      
      if (index !== -1) {
        console.log('✅ Updating group at index:', index);
        this.savedExamGroups[index] = updatedGroup;
        
        const currentlySelected = this.sharedData.getSelectedExamGroup();
        if (currentlySelected && currentlySelected.name === this.editingGroup.name) {
          console.log(`✏️ Updating currently selected group "${updatedGroup.name}"`);
          
          this.sharedData.setExamDates(updatedGroup.days);
          this.sharedData.setSelectedExamGroup(updatedGroup);
          this.sharedData.setActiveTerm(updatedGroup.termYear!);
          
          console.log("✅ Updated exam dates, triggering migration in student-mapping");
        }
      } else {
        console.error('❌ ERROR: Could not find group to update!');
        console.error('❌ Available groups:', this.savedExamGroups.map(g => g.name));
      }

      // ✅ SUCCESS: Edit mode
      Swal.fire({
        title: '✅ Group Updated!',
        html: `
          <div style="text-align: left; padding: 10px;">
            <p><strong>Exam Group:</strong> ${updatedGroup.name}</p>
            <p><strong>Term:</strong> ${this.getTermYearLabel(updatedGroup.termYear!)}</p>
            <p><strong>Dates:</strong> ${validDays.length} day(s)</p>
            <br>
            <p style="color: #10b981;">Your schedule data has been preserved.</p>
          </div>
        `,
        type: 'success',
        confirmButtonText: 'OK',
        confirmButtonColor: '#10b981'
      });

    } else {
      // ADD NEW MODE
      const existingIndex = this.savedExamGroups.findIndex(
        g => g.name === updatedGroup.name
      );

      if (existingIndex !== -1) {
        // ⚠️ Duplicate name warning
        Swal.fire({
          title: 'Duplicate Name',
          text: `"${updatedGroup.name}" already exists. Replace it?`,
          type: 'question',
          showCancelButton: true,
          confirmButtonText: 'Yes, Replace',
          cancelButtonText: 'Cancel',
          confirmButtonColor: '#3b82f6',
          cancelButtonColor: '#6b7280'
        }).then((result) => {
          if (result.value) {
            this.savedExamGroups[existingIndex] = updatedGroup;
            this.saveAllGroups();
            this.loadStoredGroups();

            // ✅ SUCCESS: Replaced
            Swal.fire({
              title: '✅ Group Replaced!',
              text: `"${updatedGroup.name}" has been updated.`,
              type: 'success',
              confirmButtonColor: '#10b981'
            });

            if (this.dialogRef) {
              this.dialogRef.close({ success: true, group: updatedGroup });
            }
          }
        });
        return;
      } else {
        this.savedExamGroups.push(updatedGroup);

        // ✅ SUCCESS: New group added
        Swal.fire({
          title: '✅ Group Saved!',
          html: `
            <div style="text-align: left; padding: 10px;">
              <p><strong>Exam Group:</strong> ${updatedGroup.name}</p>
              <p><strong>Term:</strong> ${this.getTermYearLabel(updatedGroup.termYear!)}</p>
              <p><strong>Dates:</strong> ${validDays.length} day(s)</p>
            </div>
          `,
          type: 'success',
          confirmButtonColor: '#10b981'
        });
      }
    }

    this.saveAllGroups();
    this.loadStoredGroups();

    if (this.dialogRef) {
      this.dialogRef.close({ success: true, group: updatedGroup });
    }
  }

  private getTermYearLabel(termYearCode: string): string {
    if (!termYearCode) return 'Unknown';
    
    // If already in text format, return as-is
    if (termYearCode.includes('Semester') || termYearCode.includes('Summer')) {
      return termYearCode;
    }
    
    // Convert numeric code to readable format
    // Format: "2023241" → "1st Semester SY 2023-2024"
    if (/^\d{7}$/.test(termYearCode)) {
      const termMap: any = { 
        '1': '1st Semester', 
        '2': '2nd Semester', 
        '3': 'Summer' 
      };
      const termCode = termYearCode.slice(-1);
      const year1 = termYearCode.slice(0, 4);
      const year2 = '20' + termYearCode.slice(4, 6);
      
      return `${termMap[termCode] || 'Unknown'} SY ${year1}-${year2}`;
    }
    
    return 'Unknown';
  }

  deleteGroup(groupName: string) {
    Swal.fire({
      title: 'Delete Exam Group?',
      html: `
        <div style="text-align: left; padding: 15px;">
          <p style="margin-bottom: 15px;">Delete exam group <strong>"${groupName}"</strong>?</p>
          <p style="color: #ef4444; font-weight: 600; margin-bottom: 10px;">⚠️ This will also delete any saved schedules.</p>
          <p style="color: #6b7280; font-size: 14px;">This action cannot be undone.</p>
        </div>
      `,
      type: 'warning',
      showCancelButton: true,
      confirmButtonText: 'OK',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#3b82f6',
      cancelButtonColor: '#6b7280',
      reverseButtons: true
    }).then((result) => {
      if (result.value) {
        const groupToDelete = this.savedExamGroups.find(g => g.name === groupName);
        
        const currentlySelected = this.sharedData.getSelectedExamGroup();
        const isSelectedGroup = currentlySelected && currentlySelected.name === groupName;

        this.savedExamGroups = this.savedExamGroups.filter(g => g.name !== groupName);
        this.saveAllGroups();
        this.loadStoredGroups();

        if (isSelectedGroup) {
          console.log(`🗑️ Deleted selected group "${groupName}". Clearing all data...`);
          
          this.sharedData.clearExamDates();
          this.sharedData.clearSelectedExamGroup();
          this.sharedData.clearActiveTerm();
          
          if (groupToDelete && groupToDelete.termYear) {
            this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
            console.log(`🗑️ Cleared student mapping for "${groupName}" (${groupToDelete.termYear})`);
          }
          
          this.sharedData.clearStudentMapping();
          
          Swal.fire({
            title: 'Deleted with Data',
            html: `
              <div style="text-align: left; padding: 10px;">
                <p><strong>"${groupName}"</strong> has been deleted.</p>
                <p style="color: #f59e0b; margin-top: 10px;">
                  ⚠️ All associated data has been cleared since this was the active group.
                </p>
              </div>
            `,
            type: 'warning',
            confirmButtonColor: '#f59e0b'
          });
        } else {
          if (groupToDelete && groupToDelete.termYear) {
            this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
            console.log(`🗑️ Cleared student mapping for "${groupName}" (${groupToDelete.termYear})`);
          }
          
          Swal.fire({
            title: '✅ Deleted',
            text: `"${groupName}" has been deleted successfully.`,
            type: 'success',
            confirmButtonColor: '#10b981'
          });
        }
      }
    });
  }

  selectGroup(group: ExamGroup) {
    this.selectedGroupName = group.name;
    
    this.sharedData.setExamDates(group.days);
    this.sharedData.setSelectedExamGroup(group);
    
    if (group.termYear) {
      this.sharedData.setActiveTerm(group.termYear);
      console.log(`✅ Set term to: ${group.termYear}`);
    }
    
    console.log(`✅ Selected "${group.name}" with ${group.days.length} days:`, group.days);
    
    Swal.fire({
      title: '✅ Group Selected',
      html: `
        <div style="text-align: left; padding: 10px;">
          <p><strong>Exam Group:</strong> ${group.name}</p>
          <p><strong>Term:</strong> ${this.getTermYearLabel(group.termYear || '')}</p>
          <p><strong>Dates:</strong> ${group.days.length} day(s)</p>
          <br>
          <p style="color: #10b981;">This group is now active for scheduling.</p>
        </div>
      `,
      type: 'success',
      confirmButtonColor: '#10b981',
      timer: 2000,
      showConfirmButton: false
    });
  }

  closeDialog() {
    if (this.dialogRef) {
      this.dialogRef.close();
    }
  }

  dateFilter = (date: Date | null): boolean => {
    if (!date) return true;
    const selectedDates = this.examDays
      .map(d => d.date instanceof Date ? d.date.toDateString() : null)
      .filter(d => d !== null);
    return !selectedDates.includes(date.toDateString());
  };

  getTermAndYear(group: ExamGroup): string {
    if (!group.termYear) {
      const year = new Date().getFullYear();
      return `1st Semester SY ${year}-${year + 1}`;
    }
    
    // ✅ If already in text format, return as-is
    if (group.termYear.includes('Semester') || group.termYear.includes('Summer') || group.termYear.includes('Term')) {
      return group.termYear;
    }
    
    // ✅ FIXED: Convert numeric code to "Semester SY" format
    // Format: "2023241" → "1st Semester SY 2023-2024"
    if (/^\d{7}$/.test(group.termYear)) {
      const termMap: any = { '1': '1st Semester', '2': '2nd Semester', '3': 'Summer' };
      const termCode = group.termYear.slice(-1);
      const year1 = group.termYear.slice(0, 4);
      const year2Short = group.termYear.slice(4, 6);
      const year2 = '20' + year2Short;
      
      return `${termMap[termCode] || 'Unknown'} SY ${year1}-${year2}`;
    }
    
    return 'Unknown';
  }

  getDateRange(days: ExamDay[]): string {
    if (!days || days.length === 0) return '-';

    const sorted = [...days].sort(
      (a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime()
    );

    const dateStrings = sorted.map(d => {
      const dt = new Date(d.date!);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const yy = String(dt.getFullYear()).slice(-2);
      const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
      return `${mm}/${dd}/${yy} (${weekday})`;
    });

    return dateStrings.join(', ');
  }

  isFormInvalid(): boolean {
    const hasValidDates = this.examDays.filter(d => d.date).length > 0;
    const hasGroupName = this.newGroupName && this.newGroupName.trim().length > 0;
    // ✅ CHANGED: Term year should always be set from active config, but keep validation
    return !this.selectedTermYear || !hasGroupName || !hasValidDates;
  }

  onDateChange(day: ExamDay) {
    if (day.date) {
      day.am = true;
      day.pm = true;
    } else {
      day.am = false;
      day.pm = false;
    }
  }
}