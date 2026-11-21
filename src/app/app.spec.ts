import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }

    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render AeroRoute title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('AeroRoute');
  });

  it('should toggle between dark and light themes', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app.theme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    app.toggleTheme();
    expect(app.theme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    app.toggleTheme();
    expect(app.theme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
