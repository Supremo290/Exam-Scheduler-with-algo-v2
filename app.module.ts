import { NgModule, CUSTOM_ELEMENTS_SCHEMA  } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { MaterialModule } from './material.module';
import { AppRoutingModule } from './app-routing.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { AppComponent } from './app.component';
import { LoginComponent } from './login/login.component';
import { MainComponent } from './main/main.component';
import { GlobalService } from './global.service';
import { HttpModule } from '@angular/http';
import { StorageServiceModule } from 'angular-webstorage-service';
import { CookieService } from 'ngx-cookie-service';
import { DecimalPipe, HashLocationStrategy, LocationStrategy } from '@angular/common';
import { NgxPaginationModule } from 'ngx-pagination';
import { DatePipe } from '@angular/common'
import { HttpClientModule } from '@angular/common/http';
import { MatGridListModule, MatCardModule, MatMenuModule, MatIconModule, MatButtonModule } from '@angular/material';
import { LayoutModule } from '@angular/cdk/layout';
import { MatChipsModule } from '@angular/material/chips';
import { Base64ImagesService } from './services/base64-images.service';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { ActiveConfigurationComponent } from './control-panel/active-configuration/active-configuration.component';
import { MatStepperModule } from '@angular/material/stepper';
import { MatInputModule } from '@angular/material/input';
import { ReactiveFormsModule } from '@angular/forms';


@NgModule({
  imports: [
    MatSnackBarModule,
    BrowserModule,
    AppRoutingModule,
    BrowserAnimationsModule,
    MaterialModule,
    HttpModule,
    StorageServiceModule,
    NgxPaginationModule,
    HttpClientModule,
    MatGridListModule,
    MatCardModule,
    MatMenuModule,
    MatIconModule,
    MatButtonModule,
    LayoutModule,
    MatChipsModule,
    MatSnackBarModule,
    FormsModule,
    MatStepperModule,
    MatInputModule,
    ReactiveFormsModule,
    
  ],
  declarations: [
    AppComponent,
    LoginComponent,
    MainComponent,
    ActiveConfigurationComponent,
    
  
  ],
  entryComponents: [
    ActiveConfigurationComponent

   ],

  providers: [    
    GlobalService,
    CookieService,
    Base64ImagesService,
    DecimalPipe,    
    { provide: LocationStrategy, useClass: HashLocationStrategy },
    DatePipe
  ],
  bootstrap: [AppComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class AppModule { }
