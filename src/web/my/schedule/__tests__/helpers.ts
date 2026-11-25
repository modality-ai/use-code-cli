import { expect } from "bun:test";
import { act } from "reshow-unit";

export const clearScheduleStorage = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("schedule:local-adds");
  window.sessionStorage.removeItem("schedule:notice");
};

export const query = (container: HTMLElement, selector: string) =>
  container.querySelector(selector) as HTMLElement | null;

const dispatchValue = (field: HTMLInputElement | HTMLSelectElement) => {
  const EventCtor =
    (field.ownerDocument.defaultView as unknown as { Event?: typeof Event } | null)?.Event ?? Event;
  field.dispatchEvent(new EventCtor("input", { bubbles: true }));
  field.dispatchEvent(new EventCtor("change", { bubbles: true }));
};

export const typeInto = (input: HTMLInputElement, value: string) => {
  input.value = value;
  dispatchValue(input);
};

export const setFieldValue = (field: HTMLInputElement | HTMLSelectElement, value: string) => {
  let prototype: object | null = Object.getPrototypeOf(field);
  let setter: ((value: string) => void) | undefined;
  while (prototype && !setter) {
    setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set as ((value: string) => void) | undefined;
    prototype = Object.getPrototypeOf(prototype);
  }
  if (setter) setter.call(field, value);
  else field.value = value;
  dispatchValue(field);
};

export const submitButton = (container: HTMLElement) =>
  query(container, 'button[type="submit"]') as HTMLButtonElement;

export const clickButton = async (container: HTMLElement, label: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  ) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(() => { button.click(); });
};
