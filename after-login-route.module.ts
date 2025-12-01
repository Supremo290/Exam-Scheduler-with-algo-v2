import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { HomeComponent } from './../../home/home.component';
import { ExamScheduleUploaderComponent } from '../../academic/exam-schedule/exam-schedule-uploader/exam-schedule-uploader.component';
import { ExamScheduleManagerComponent } from '../../academic/exam-schedule/exam-schedule-manager/exam-schedule-manager.component';
import { HelloWorldComponent } from '../../hello-world/hello-world.component';
import { GenerateScheduleComponent } from '../../generate-schedule/generate-schedule.component';
import { StudentMappingComponent } from '../../student-mapping/student-mapping.component';
import { DatePickerComponent } from '../../date-picker/date-picker.component';
import { MainSchedulingComponent } from '../../main-scheduling/main-scheduling.component';
import { RoomMappingComponent } from '../../room-mapping/room-mapping.component';
import { FinalOutputComponent } from '../../final-output/final-output.component';
import { ExamSchedulerComponent } from '../../exam-scheduler/exam-scheduler.component';


const routes: Routes = [
  { path: 'home', component: HomeComponent, outlet: 'div' },
  { path: 'exam-schedule-uploader', component: ExamScheduleUploaderComponent, outlet: 'div' },
  { path: 'exam-schedule-manager', component: ExamScheduleManagerComponent, outlet: 'div' },
  { path: 'hello-world', component: HelloWorldComponent, outlet: 'div'},
  { path: 'generate-schedule', component: GenerateScheduleComponent, outlet: 'div' },
  { path: 'student-mapping', component: StudentMappingComponent, outlet: 'div' },
  { path: 'main-scheduling', component: MainSchedulingComponent, outlet: 'div' },
  { path: 'room-mapping', component: RoomMappingComponent, outlet: 'div' },
  { path: 'final-output', component: FinalOutputComponent, outlet: 'div' },
  { path: 'exam-scheduler', component: ExamSchedulerComponent, outlet: 'div' },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AfterLoginRouteModule { }
