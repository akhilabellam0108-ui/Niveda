import type { LucideIcon } from 'lucide-react';
import {
  Stethoscope, Activity, Pill, TriangleAlert, Scissors, Syringe, FlaskConical, Microscope, ScanLine,
  BedDouble, Brain, Users, CalendarClock, NotebookPen, FileText,
} from 'lucide-react';
import type { RecordType } from '@shared/types';

export const RECORD_ICON: Record<RecordType, LucideIcon> = {
  consultation: Stethoscope,
  diagnosis: Activity,
  medication: Pill,
  allergy: TriangleAlert,
  surgery: Scissors,
  procedure: Scissors,
  lab_test: FlaskConical,
  lab_result: Microscope,
  imaging: ScanLine,
  vaccination: Syringe,
  hospitalization: BedDouble,
  mental_health: Brain,
  family_history: Users,
  follow_up: CalendarClock,
  clinical_note: NotebookPen,
  other: FileText,
};

export const RECORD_TONE: Record<RecordType, string> = {
  consultation: 'tone-accent',
  diagnosis: 'tone-violet',
  medication: 'tone-info',
  allergy: 'tone-danger',
  surgery: 'tone-warn',
  procedure: 'tone-warn',
  lab_test: 'tone-ok',
  lab_result: 'tone-ok',
  imaging: 'tone-info',
  vaccination: 'tone-accent',
  hospitalization: 'tone-warn',
  mental_health: 'tone-violet',
  family_history: '',
  follow_up: 'tone-accent',
  clinical_note: '',
  other: '',
};
