import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { AfterLoginRouteModule } from './after-login-route.module';
import { MaterialModule } from './../../material.module';
import { CommonModule } from '@angular/common';
import { HomeComponent } from './../../home/home.component';
import { NgxPaginationModule } from 'ngx-pagination';
import { MatChipsModule } from '@angular/material/chips';
import { ImageCropperModule } from 'ngx-image-cropper';
import { MatBadgeModule, MatDialogModule } from '@angular/material';
import { CustomNumberPipe } from './../../pipes/custom-number.pipe';
import { PopupComponent } from '../../pop-up/popup/popup.component';
import { ExamScheduleUploaderComponent } from '../../academic/exam-schedule/exam-schedule-uploader/exam-schedule-uploader.component';
import { ExamScheduleManagerComponent } from '../../academic/exam-schedule/exam-schedule-manager/exam-schedule-manager.component';
import { HelloWorldComponent } from '../../hello-world/hello-world.component';
import { GenerateScheduleComponent } from '../../generate-schedule/generate-schedule.component';
import { StudentMappingComponent } from '../../student-mapping/student-mapping.component';
import { DatePickerComponent } from '../../date-picker/date-picker.component';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MainSchedulingComponent } from '../../main-scheduling/main-scheduling.component';
import { RoomMappingComponent } from '../../room-mapping/room-mapping.component';
import { FinalOutputComponent } from '../../final-output/final-output.component';
import { ExamSchedulerComponent } from '../../exam-scheduler/exam-scheduler.component';
import { UniquePipe } from '../../exam-scheduler/unique.pipe';
import { FormsModule } from '@angular/forms';

@NgModule({
  imports: [
    CommonModule,
    AfterLoginRouteModule,
    MaterialModule,
    NgxPaginationModule,
    MatChipsModule,
    ImageCropperModule,
    MatBadgeModule,
    MatDialogModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
    FormsModule
    
  ],
  declarations: [    
    HomeComponent,    
    CustomNumberPipe,
    PopupComponent,
    ExamScheduleUploaderComponent,
    ExamScheduleManagerComponent,
    HelloWorldComponent,
    GenerateScheduleComponent,
    StudentMappingComponent,
    DatePickerComponent,
    MainSchedulingComponent,
    RoomMappingComponent,
    FinalOutputComponent,
    ExamSchedulerComponent,
    UniquePipe
  ],
  entryComponents: [
    DatePickerComponent
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class AfterLoginModule { }
