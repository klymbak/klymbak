import "@angular/compiler";
import { getTestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { afterEach } from "vitest";

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
// Angular resets TestBed through a global afterEach, which Vitest doesn't define unless globals are on.
afterEach(() => getTestBed().resetTestingModule());
