import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ActiveConfigurationComponent } from './active-configuration.component';

describe('ActiveConfigurationComponent', () => {
  let component: ActiveConfigurationComponent;
  let fixture: ComponentFixture<ActiveConfigurationComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ActiveConfigurationComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ActiveConfigurationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
