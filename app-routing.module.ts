import { NgModule } from '@angular/core';
import { Routes, RouterModule, } from '@angular/router';//PreloadAllModules
import { LoginComponent } from './login/login.component';
import { MainComponent } from './main/main.component';


const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,  },
  {
    path: 'main',
    component: MainComponent,
    loadChildren: () => import('./modules/after-login/after-login.module').then(m => m.AfterLoginModule)

  },
  {
    path: '**', redirectTo: 'login'
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],//, {preloadingStrategy: PreloadAllModules}
  exports: [RouterModule]
})
export class AppRoutingModule { }
