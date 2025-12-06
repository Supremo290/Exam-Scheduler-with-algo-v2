import { Component, OnInit } from '@angular/core';
import { GlobalService } from './../../global.service';
import { Router } from "@angular/router";
import { CookieService } from 'ngx-cookie-service';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material';
import { Inject } from '@angular/core';

@Component({
  selector: 'app-active-configuration',
  templateUrl: './active-configuration.component.html',
  styleUrls: ['./active-configuration.component.scss']
})
export class ActiveConfigurationComponent implements OnInit {
  proglevel = '';
  activeterm = 0;
  year1;
  year2;
  x
  constructor(public dialogRef: MatDialogRef<ActiveConfigurationComponent>, @Inject(MAT_DIALOG_DATA) public data: any, public global: GlobalService, private router: Router, private cookieService: CookieService) {
    var dt = new Date();
    this.year1 = dt.getFullYear();
    this.yearchange1();

    if (global.syear != null) {
      this.proglevel = global.domain;
      this.activeterm = global.syear.substring(6, 7)
      this.year1 = global.syear.substring(0, 4)
      this.year2 = (parseInt(global.syear.substring(0, 4)) + 1).toString()
    }

    this.x = localStorage.getItem('domain')
    if (data.x != undefined || data.x != null) {
      if (data.x == 0) {
        this.x == null
      }
    }

  }

  setschoolyear() {
    var x = "";
    if (this.year1 < 1900 || this.year2 > 2999)
      x = x + "*Must Enter Appropriate School Year";
    var checkdomain = true
    if (this.global.checkdomain('0001') ||
      this.global.checkdomain('0002') ||
      this.global.checkdomain('0003') ||
      this.global.checkdomain('0004') ||
      this.global.checkdomain('0005') ||
      this.global.checkdomain('0006') ||
      this.global.checkdomain('0008') ||
      this.global.checkdomain('0009') ||
      this.global.checkdomain('0010') ||
      this.global.checkdomain('0071') ||
      this.global.checkdomain('0072') ||
      this.global.checkdomain('0073')) {
      if (this.proglevel == "COLLEGE" || this.proglevel == "GRADUATE SCHOOL")
        if (this.activeterm < 1 || this.activeterm > 3)
          x = x + "*Active Term is required<br>";
      if (this.proglevel == '')
        x = x + "*Program level is required<br>";
      checkdomain = false
    }
    if (this.proglevel == "ELEMENTARY" || this.proglevel == "HIGHSCHOOL")
      this.activeterm = 1
    if (checkdomain) {
      this.proglevel = ''
    }
    var indicator = 0;

    for (var i = 0; i < this.global.allsyoptions.length; ++i) {
      if (this.year1.toString() + this.year2.toString().substr(1).substr(1) + this.activeterm.toString() == this.global.allsyoptions[i].syWithSem) {
        indicator = 1
        break
      }
    }
    if (indicator == 0) {
      x = x + "*Invalid school year setting!<br>";
    }
    if (x == "") {

      this.router.navigate(['../main', { outlets: { div: 'home' } }], { skipLocationChange: true });
      if (this.activeterm == 0) {
        this.cookieService.set('domain', this.proglevel)
        this.cookieService.set('year', this.year1.toString() + this.year2.toString() + '1')
        this.global.sysetting(this.proglevel, this.year1.toString() + this.year2.toString() + '1')
      }
      else {
        this.cookieService.set('domain', this.proglevel)
        this.cookieService.set('year', this.year1.toString() + this.year2.toString() + this.activeterm.toString())
        this.global.sysetting(this.proglevel, this.year1.toString() + this.year2.toString() + this.activeterm.toString())
      }


      this.save();
      this.global.swalSuccess('Active Configuration Updated!');
    } else {
      if (this.global.allsyoptions.length == 0) {
        this.global.swalAlert('No School Year Found!', 'Please contact your system administrator!', "warning");
      } else
        this.global.swalAlert(x, '', "warning");
    }


  }

  yearchange1() {
    this.year2 = this.year1 + 1;
  }
  yearchange2() {
    this.year1 = this.year2 - 1;
  }

  ngOnInit() {
    if (this.global.checkdomain('0001') ||
      this.global.checkdomain('0002') ||
      this.global.checkdomain('0003') ||
      this.global.checkdomain('0004') ||
      this.global.checkdomain('0005') ||
      this.global.checkdomain('0006') ||
      this.global.checkdomain('0008') ||
      this.global.checkdomain('0009') ||
      this.global.checkdomain('0010') ||
      this.global.checkdomain('0071') ||
      this.global.checkdomain('0072') ||
      this.global.checkdomain('0073')) {
      if (this.global.requestid() != localStorage.getItem('idno')) {
        this.proglevel = '';
      }
    } else {
      this.proglevel = "COLLEGE";
    }
  }

  close(): void {
    this.dialogRef.close({ result: 'cancel' });
  }
  save(): void {
    this.dialogRef.close({ result: 'save' });
  }

}
