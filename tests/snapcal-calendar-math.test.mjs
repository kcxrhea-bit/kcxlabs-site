import test from "node:test";
import assert from "node:assert/strict";

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return { date, inCurrentMonth: date.getFullYear() === year && date.getMonth() === month };
  });
}

test("August 2026 grid has August dates and September transition starts a new month", () => {
  const august = buildMonthGrid(2026, 7);
  const september = buildMonthGrid(2026, 8);
  assert.equal(august.filter((cell) => cell.inCurrentMonth).length, 31);
  assert.equal(september.filter((cell) => cell.inCurrentMonth).length, 30);
  assert.ok(august.some((cell) => cell.date.getMonth() === 8 && !cell.inCurrentMonth));
  assert.ok(september.some((cell) => cell.date.getMonth() === 7 && !cell.inCurrentMonth));
});

test("February 2028 includes leap day and correct month membership", () => {
  const february = buildMonthGrid(2028, 1);
  assert.equal(february.filter((cell) => cell.inCurrentMonth).length, 29);
  assert.ok(february.some((cell) => cell.inCurrentMonth && cell.date.getDate() === 29));
});

test("month grid uses year as part of current-month identity", () => {
  const january = buildMonthGrid(2026, 0);
  assert.ok(january.every((cell) => cell.inCurrentMonth ? cell.date.getFullYear() === 2026 : true));
});
