import { FieldModel } from "../models/field/field.model";
import { TimeSlotModel } from "../models/TimeSlot/timeSlot.model";
import { SubFieldModel } from "../models/subField/subField.model";

const OPEN_HOURS_REGEX = /^([01]\d|2[0-3]):([0-5]\d)\s*[-–—]\s*([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_TIME_SLOT_STEP_MINUTES = 30;

const padTimeValue = (value: number) => String(value).padStart(2, "0");

const minutesToTimeLabel = (minutes: number) => {
  const normalizedMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
  const hour = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;
  return `${padTimeValue(hour)}:${padTimeValue(minute)}`;
};

const timeToMinutes = (value: string) => {
  const normalizedValue = String(value || "").trim();
  const matched = normalizedValue.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!matched) {
    return Number.NaN;
  }

  return Number(matched[1]) * 60 + Number(matched[2]);
};

export const normalizeOpenHoursValue = (value: unknown) =>
  String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "")
    .trim();

export const parseOpenHoursRange = (value: unknown) => {
  const normalizedValue = normalizeOpenHoursValue(value);
  const matched = normalizedValue.match(OPEN_HOURS_REGEX);

  if (!matched) {
    return null;
  }

  const startTime = `${matched[1]}:${matched[2]}`;
  const endTime = `${matched[3]}:${matched[4]}`;
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
    return null;
  }

  return {
    startTime,
    endTime,
    startMinutes,
    endMinutes,
    normalizedValue: `${startTime}-${endTime}`,
  };
};

export const buildTimeSlotsFromOpenHours = (
  openHours: unknown,
  stepMinutes = DEFAULT_TIME_SLOT_STEP_MINUTES,
) => {
  const parsedOpenHours = parseOpenHoursRange(openHours);

  if (!parsedOpenHours) {
    return [];
  }

  const safeStepMinutes = Number(stepMinutes);
  if (!Number.isFinite(safeStepMinutes) || safeStepMinutes <= 0) {
    return [];
  }

  const slots = [];

  for (
    let currentMinutes = parsedOpenHours.startMinutes;
    currentMinutes + safeStepMinutes <= parsedOpenHours.endMinutes;
    currentMinutes += safeStepMinutes
  ) {
    const nextMinutes = currentMinutes + safeStepMinutes;
    const startTime = minutesToTimeLabel(currentMinutes);
    const endTime = minutesToTimeLabel(nextMinutes);
    slots.push({
      startTime,
      endTime,
      label: `${startTime} - ${endTime}`,
    });
  }

  return slots;
};

const getTimeSlotIdentity = (slot: { startTime?: string; endTime?: string }) => {
  const startTime = String(slot?.startTime || "").trim();
  const endTime = String(slot?.endTime || "").trim();
  return startTime && endTime ? `${startTime}-${endTime}` : "";
};

const buildRequiredTimeSlotEntries = (openHoursValues: unknown[] = []) => {
  const requiredEntries = new Map<
    string,
    { startTime: string; endTime: string; label: string }
  >();

  (Array.isArray(openHoursValues) ? openHoursValues : []).forEach((openHours) => {
    buildTimeSlotsFromOpenHours(openHours).forEach((slot) => {
      const identity = getTimeSlotIdentity(slot);
      if (!identity || requiredEntries.has(identity)) {
        return;
      }

      requiredEntries.set(identity, slot);
    });
  });

  return Array.from(requiredEntries.values());
};

const ensureRequiredTimeSlotEntries = async (
  requiredEntries: Array<{ startTime: string; endTime: string; label: string }> = [],
) => {
  if (requiredEntries.length === 0) {
    return { createdCount: 0, totalCount: 0 };
  }

  const conditions = requiredEntries.map((slot) => ({
    startTime: slot.startTime,
    endTime: slot.endTime,
  }));
  const existingSlots = await TimeSlotModel.find({
    $or: conditions,
  });
  const existingSlotsByIdentity = new Map(
    existingSlots.map((slot) => [
      getTimeSlotIdentity({ startTime: slot.startTime, endTime: slot.endTime }),
      slot,
    ]),
  );

  const writeOperations = requiredEntries.reduce<any[]>((operations, slot) => {
    const identity = getTimeSlotIdentity(slot);
    const existingSlot = existingSlotsByIdentity.get(identity);

    if (existingSlot && !existingSlot.isDeleted) {
      return operations;
    }

    if (existingSlot?._id) {
      operations.push({
        updateOne: {
          filter: { _id: existingSlot._id },
          update: {
            $set: {
              startTime: slot.startTime,
              endTime: slot.endTime,
              label: slot.label,
              isDeleted: false,
            },
          },
        },
      });
      return operations;
    }

    operations.push({
      updateOne: {
        filter: {
          startTime: slot.startTime,
          endTime: slot.endTime,
          isDeleted: false,
        },
        update: {
          $setOnInsert: {
            startTime: slot.startTime,
            endTime: slot.endTime,
            label: slot.label,
            isDeleted: false,
          },
        },
        upsert: true,
      },
    });

    return operations;
  }, []);

  if (writeOperations.length > 0) {
    await TimeSlotModel.bulkWrite(writeOperations, { ordered: false });
  }

  return {
    createdCount: writeOperations.length,
    totalCount: requiredEntries.length,
  };
};

export const ensureTimeSlotsForOpenHours = async (openHours: unknown) =>
  ensureRequiredTimeSlotEntries(buildRequiredTimeSlotEntries([openHours]));

export const ensureTimeSlotsForOpenHoursList = async (openHoursValues: unknown[] = []) =>
  ensureRequiredTimeSlotEntries(buildRequiredTimeSlotEntries(openHoursValues));

export const syncTimeSlotsFromStoredOpenHours = async () => {
  const [fields, subFields] = await Promise.all([
    FieldModel.find({ isDeleted: false }).select("openHours").lean(),
    SubFieldModel.find({ isDeleted: false }).select("openHours").lean(),
  ]);

  const collectedOpenHours = [...fields, ...subFields]
    .map((item: any) => String(item?.openHours || "").trim())
    .filter(Boolean);

  return ensureRequiredTimeSlotEntries(buildRequiredTimeSlotEntries(collectedOpenHours));
};
