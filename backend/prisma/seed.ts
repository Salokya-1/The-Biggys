/**
 * Demo seed — realistic, fictional, idempotent (truncates and rebuilds).
 *
 *   npm run seed          (or: npx prisma db seed / npm run db:reset)
 *
 * Produces: the six real Islington programmes with their London Met module lists, each intake
 * split into 8 sections of 20 students, a faculty where every module is staffed by two teachers,
 * semesters of published history, a semester currently in the result pipeline with a sheet in
 * every state, resits, classrooms and exam halls, exam sessions, weekly routines that follow the
 * lecture/tutorial/workshop day pattern, deliberate data-quality issues, notifications and demo
 * accounts.
 * All names and numbers are invented. No real student data.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type ClassKind, type MarkSheetStatus, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { computeGrade, type ComponentSpec } from '../src/lib/grading';
import { generateSeating } from '../src/lib/seating';
import { generateTimetable, isFinalYearSemester, periodsForSemester, yearOfSemester, type ExistingBooking } from '../src/lib/timetable';
import { examSlots, generateExamSchedule } from '../src/lib/exam-schedule';

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'Demo1234!';

// ---------- deterministic PRNG (mulberry32) so every seed run is identical ----------
let seedState = 20260912;
function rand(): number {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const gauss = (mean: number, sd: number) => {
  const u = 1 - rand();
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// 52 × 42 = 2184 combinations, comfortably more than the 1600 students the seed creates — a
// smaller pool would fill the dashboard's duplicate-name check with noise that is not a real
// data-quality problem.
const FIRST = ['Aarav', 'Anisha', 'Bibek', 'Binita', 'Dipesh', 'Diya', 'Kiran', 'Kritika', 'Manish', 'Nisha', 'Prabin', 'Pratima', 'Rajan', 'Rojina', 'Sagar', 'Samiksha', 'Sandesh', 'Shristi', 'Sujan', 'Sunita', 'Utsav', 'Yashoda', 'Nabin', 'Pooja', 'Rohan', 'Sneha', 'Bishal', 'Aayush', 'Priya', 'Suman', 'Anmol', 'Barsha', 'Deepak', 'Ishwor', 'Jenisha', 'Kushal', 'Milan', 'Nirajan', 'Ojaswi', 'Prasanna', 'Rabin', 'Sabin', 'Salina', 'Sudip', 'Tara', 'Ujjwal', 'Bimala', 'Hari', 'Laxmi', 'Nabina', 'Roshan', 'Sarita'];
const LAST = ['Shrestha', 'Karki', 'Rai', 'Gurung', 'Tamang', 'Thapa', 'Lama', 'Magar', 'Adhikari', 'Basnet', 'Bhattarai', 'Dahal', 'Ghimire', 'Joshi', 'KC', 'Khadka', 'Limbu', 'Maharjan', 'Pandey', 'Poudel', 'Regmi', 'Sharma', 'Subedi', 'Acharya', 'Bhandari', 'Chaudhary', 'Dhakal', 'Gautam', 'Giri', 'Kafle', 'Koirala', 'Neupane', 'Ojha', 'Panta', 'Paudel', 'Rijal', 'Sapkota', 'Shahi', 'Sherpa', 'Silwal', 'Timalsina', 'Yadav'];

const date = (y: number, m: number, d: number, h = 9) => new Date(Date.UTC(y, m - 1, d, h - 5, 15)); // ~NPT

async function truncateAll() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "Notification", "AuditLog", "SeatAllocation", "ExamInvigilator", "ExamSession", "Venue", "ImportBatch",
      "Result", "Mark", "MarkSheet", "RefreshToken", "Enrollment", "AssessmentComponent", "ModuleOffering",
      "TimetableSlot", "SlotException", "ChangeRequest", "FeeInvoice", "AdmitCard", "Section",
      "Module", "Student", "Semester", "Intake", "Programme", "GradingScheme", "User" CASCADE`);
}

async function main() {
  console.log('seed: truncating');
  await truncateAll();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ---------- users ----------
  const mkUser = (email: string, name: string, role: Role) => prisma.user.create({ data: { email, name, role, passwordHash } });
  const admin = await mkUser('admin@demo', 'Sita Tandon', 'ADMIN');
  const leaderCS = await mkUser('leader@demo', 'Bikash Rai', 'MODULE_LEADER');
  const leaderCS2 = await mkUser('leader2@demo', 'Prakash Adhikari', 'MODULE_LEADER');
  const leaderBM = await mkUser('leader3@demo', 'Sarita Joshi', 'MODULE_LEADER');
  const lecturer = await mkUser('lecturer@demo', 'Chetna Gurung', 'LECTURER');
  const lecturers = [
    lecturer,
    await mkUser('lecturer2@demo', 'Ramesh Poudel', 'LECTURER'),
    await mkUser('lecturer3@demo', 'Sabina Tamang', 'LECTURER'),
    await mkUser('lecturer4@demo', 'Niraj Bhattarai', 'LECTURER'),
    await mkUser('lecturer5@demo', 'Kabita Regmi', 'LECTURER'),
  ];

  // A full teaching faculty. Every module is staffed by two of these, and one teacher takes
  // several sections of the same module across the week — which is what the routine has to
  // schedule around, and what makes the clash detection worth having.
  // Two teachers per module and at most two modules per teacher — the load a real lecturer
  // carries once you count four sections of every module they take.
  // The teaching staff named on Islington's own Autumn 2025 allocation sheet. Only the allocation
  // is modelled against them — classes, rooms and contact hours, exactly the kind of thing that
  // sheet already records. Every student, mark and result in this seed is invented.
  const FACULTY_NAMES = [
  'Mr. Aadesh Tandukar', 'Mr. Aaditya Khwakhwali', 'Mr. Aakash Khatiwada', 'Mr. Aaryan Jha',
  'Mr. Aashish Acharya', 'Mr. Aashish Rimal', 'Mr. Abhishek Anand', 'Mr. Abhishek Bhatta',
  'Mr. Abishek Subedi', 'Mr. Alish KC', 'Mr. Anil Kumar Yadav', 'Mr. Anish Chapagain',
  'Mr. Anish Pudasaini', 'Mr. Ankur Singh Thapa', 'Mr. Ankush Ojha', 'Mr. Anuj Shilpakar',
  'Mr. Ardent Sharma', 'Mr. Aryan Thapa', 'Mr. Ashitosh Sah', 'Mr. Ashok Dhungana',
  'Mr. Ayush Bajracharya', 'Mr. Ayush Bhakta Pradhanang', 'Mr. Ayush Man Tamrakar', 'Mr. Basudev Raut',
  'Mr. Bibek Baral', 'Mr. Bijay Raj Shakya', 'Mr. Bikram Poudel', 'Mr. Binaya Ratna Shakya',
  'Mr. Binod Bhattarai', 'Mr. Bishal GC', 'Mr. Bishnu Pandey', 'Mr. Bisista Koirala',
  'Mr. Dhurba Pandey', 'Mr. Dibesh Maskey', 'Mr. Dip Parajuli', 'Mr. Dipesh Raj Adhikari',
  'Mr. Dipeshor Silwal', 'Mr. Ganesh Subedi', 'Mr. Gyanendra Maharjan', 'Mr. Hrishav Tandukar',
  'Mr. Indra Dhakal', 'Mr. Ishan Singh Thakuri', 'Mr. Jaganath Paudyal', 'Mr. Jayaram Pudasaini',
  'Mr. Juned Alam', 'Mr. Kamal Bhusal', 'Mr. Kiran Shrestha', 'Mr. Koshish Jung Lamichhane',
  'Mr. Lekhnath Katuwal', 'Mr. Mahotsav Bhattarai', 'Mr. Manas Koirala', 'Mr. Manoj Jaishi',
  'Mr. Mukesh Regmi', 'Mr. Nadil Bahadur Paudel', 'Mr. Nischal Pradhan', 'Mr. Nischaya Subedi',
  'Mr. Nishchal Paudel', 'Mr. Parbat Bhujel', 'Mr. Pawal Kharel', 'Mr. Prabin Dangol',
  'Mr. Prabin Silwal', 'Mr. Prajwal Adhikari', 'Mr. Prajwal Thapa', 'Mr. Prajwol Khadka',
  'Mr. Prakash Ghimire', 'Mr. Prakat Narayan Shrestha', 'Mr. Prashant Lal Shrestha', 'Mr. Prashant Pudasaini',
  'Mr. Pratik Panta', 'Mr. Rajeev Shrestha', 'Mr. Rakshak Bhusan Bajracharya', 'Mr. Raman Pradhananga',
  'Mr. Ravi Maharjan', 'Mr. Rohit Man Amatya', 'Mr. Roshan Pokhrel', 'Mr. Roshan Shrestha',
  'Mr. Rubin Thapa', 'Mr. Sagar Basnet', 'Mr. Samrid Budathoki', 'Mr. Sandesh Prasad Poudel',
  'Mr. Sanjeep Lama', 'Mr. Sanjish Wagle', 'Mr. Saroj Kumar Yadav', 'Mr. Saurabh Adhikari',
  'Mr. Shashwot Singh Shahi', 'Mr. Shishir Subedi', 'Mr. Subarna Sapkota', 'Mr. Subash Sharma',
  'Mr. Sugam Giri', 'Mr. Sugat Shakya', 'Mr. Sujan KC', 'Mr. Sujil Maharjan',
  'Mr. Sumit Pathak', 'Mr. Sumit Shrestha', 'Mr. Suraj Neupane', 'Mr. Surendra Nepal',
  'Mr. Sushil Prasad Sharma', 'Mr. Swarnim Pravidhi Chaulagain', 'Mr. Ujjwal Subedi', 'Mr. Utsab Shrestha',
  'Mr. Vishal Joshi', 'Mr. Yaman Shakya', 'Mr. Yushef Shrestha', 'Mr. Yuyutsav Subedi',
  'Ms. Ankit Acharya', 'Ms. Apekshya Sigdel', 'Ms. Arati Shilpakar', 'Ms. Asira Khanal',
  'Ms. Astha Sharma', 'Ms. Jashmine Bajracharya', 'Ms. Katyani Bajgain', 'Ms. Kiran Chand',
  'Ms. Labbi Karmacharya', 'Ms. Neelima Khanal', 'Ms. Neeta Subedi', 'Ms. Priyanka Acharya',
  'Ms. Priyasha K.C.', 'Ms. Rabina Lama', 'Ms. Samata Shrestha', 'Ms. Samita Thapa',
  'Ms. Sarika Dahal', 'Ms. Saumya Subedi', 'Ms. Selina Shakya', 'Ms. Shambhavi Dhakal',
  'Ms. Shresha Rajbhandari', 'Ms. Somia Dahal', 'Ms. Supriya Tamrakar', 'Ms. Vedika Thapa',
  ];
  const FACULTY_SIZE = FACULTY_NAMES.length;
  // The demo staff sit at the front of the pool, so signing in as lecturer@demo or leader@demo
  // shows a real teaching week rather than an empty timetable.
  const faculty = [
    ...lecturers.map((l) => ({ id: l.id, name: l.name, email: l.email })),
    { id: leaderCS.id, name: leaderCS.name, email: leaderCS.email },
    { id: leaderCS2.id, name: leaderCS2.name, email: leaderCS2.email },
    { id: leaderBM.id, name: leaderBM.name, email: leaderBM.email },
    ...FACULTY_NAMES.map((name, i) => ({ id: randomUUID(), name, email: `teacher${i + 1}@demo` })),
  ];
  // Only the invented ones need creating; the demo accounts already exist.
  const existing = new Set([...lecturers.map((l) => l.id), leaderCS.id, leaderCS2.id, leaderBM.id]);
  await prisma.user.createMany({ data: faculty.filter((f) => !existing.has(f.id)).map((f) => ({ id: f.id, email: f.email, name: f.name, role: 'LECTURER' as Role, passwordHash })) });
  /** Everyone who can be put in front of a class. */
  const teachingStaff = [...lecturers.map((l) => ({ id: l.id, name: l.name })), ...faculty.map((f) => ({ id: f.id, name: f.name }))];

  const scheme = await prisma.gradingScheme.create({
    data: {
      name: 'Default (assumed)',
      passMark: 40,
      resitCap: 40,
      isDefault: true,
      bands: [
        { grade: 'A', min: 70 },
        { grade: 'B', min: 60 },
        { grade: 'C', min: 50 },
        { grade: 'D', min: 40 },
        { grade: 'F', min: 0 },
      ],
    },
  });

  // ---------- programmes, intakes, semesters ----------
  // Real Islington College programme catalogue and London Metropolitan University module lists
  // (islington.edu.np + "Modules with code and credit of Islington"). `history: true` programmes get
  // three intakes with published results and a live pipeline; the others start with Sep 2026 only.
  const programmes = [
    { code: 'BSCC', name: 'BSc (Hons) Computing', level: 'Undergraduate (London Metropolitan University)', idPrefix: '01', history: true },
    { code: 'BABA', name: 'BA (Hons) Business Administration', level: 'Undergraduate (London Metropolitan University)', idPrefix: '02', history: true },
    { code: 'BSCNIS', name: 'BSc (Hons) Computer Networking & IT Security', level: 'Undergraduate (London Metropolitan University)', idPrefix: '03', history: false },
    { code: 'BSCMT', name: 'BSc (Hons) Multimedia Technologies', level: 'Undergraduate (London Metropolitan University)', idPrefix: '04', history: false },
    { code: 'BSCAI', name: 'BSc (Hons) Computing with Artificial Intelligence', level: 'Undergraduate (London Metropolitan University)', idPrefix: '05', history: false },
    { code: 'BAAF', name: 'BA (Hons) Accounting & Finance', level: 'Undergraduate (London Metropolitan University)', idPrefix: '06', history: false },
  ];

  // Academic calendar: Autumn and Spring semesters of 14 weeks each (12 teaching + 2 exam weeks),
  // 28 weeks a year, summer break in between. Autumn starts mid-September, Spring mid-February.
  const week = 7 * 86400e3;
  /** The teaching week is Sunday to Friday, so a semester begins on a Sunday. */
  const sundayOnOrBefore = (d: Date) => new Date(d.getTime() - d.getUTCDay() * 86400e3);
  const semWindow = (startYear: number, n: number) => {
    const yearOffset = Math.floor((n - 1) / 2);
    const y = startYear + yearOffset;
    const start = sundayOnOrBefore(n % 2 === 1 ? date(y, 9, 14) : date(y + 1, 2, 16));
    const examStart = new Date(start.getTime() + 12 * week);
    const examEnd = new Date(examStart.getTime() + 2 * week);
    return { start, end: examEnd, examStart, examEnd, term: n % 2 === 1 ? ('AUTUMN' as const) : ('SPRING' as const) };
  };
  /**
   * Groups are named the way the live allocation sheet names them: the programme's letter plus a
   * number, so C1…C8 are Computing groups and N1…N8 Networking ones. That is what appears on a
   * lecture row as "C1+C2+…" and on a workshop row as a single group.
   */
  const GROUP_PREFIX: Record<string, string> = { BSCC: 'C', BSCAI: 'AI', BSCNIS: 'N', BSCMT: 'M', BABA: 'B', BAAF: 'AF' };

  // Every intake runs as 8 sections of 20 — the shape RTE actually timetables against.
  const SECTION_SIZE = 20;
  const SECTIONS_PER_INTAKE = 8;
  const COHORT_SIZE = SECTION_SIZE * SECTIONS_PER_INTAKE;
  // intake → number of semesters that exist so far (current semester is the last one)
  const intakes = [
    { label: 'Sep 2024', year: 2024, semesters: 5, published: 4, inPipeline: null as number | null },
    { label: 'Sep 2025', year: 2025, semesters: 3, published: 1, inPipeline: 2 },
    { label: 'Sep 2026', year: 2026, semesters: 1, published: 0, inPipeline: null },
  ];

  /** 60/40 coursework + exam, the common shape for a 15-credit module. */
  function cw60ex40(examMin?: number): ComponentSpec[] {
    return [
      { id: '', name: 'Coursework', weight: 60, maxMark: 100 },
      { id: '', name: 'Exam', weight: 40, maxMark: 100, componentPassMark: examMin ?? null },
    ];
  }
  /** Two courseworks and an exam, used for 30-credit modules. */
  function three(): ComponentSpec[] {
    return [
      { id: '', name: 'Coursework 1', weight: 30, maxMark: 100 },
      { id: '', name: 'Coursework 2', weight: 30, maxMark: 100 },
      { id: '', name: 'Exam', weight: 40, maxMark: 50 },
    ];
  }

  // Year lists exactly as published; each year is split across its two semesters (60 credits each).
  type Mod = { code: string; title: string; credits: number };
  const CATALOGUE: Record<string, Mod[][]> = {
    BSCC: [
      [
        { code: 'CC4057', title: 'Introduction to Information Systems', credits: 15 },
        { code: 'CC4051', title: 'Fundamentals of Computing', credits: 15 },
        { code: 'MA4001', title: 'Logic and Problem Solving', credits: 30 },
        { code: 'CT4005', title: 'Computing Hardware and Software Architecture', credits: 30 },
        { code: 'CS4001', title: 'Programming', credits: 30 },
      ],
      [
        { code: 'CC5051', title: 'Databases', credits: 15 },
        { code: 'CS5002', title: 'Software Engineering', credits: 30 },
        { code: 'CT5052', title: 'Network Operating Systems', credits: 15 },
        { code: 'CS5053', title: 'Cloud Computing and Internet of Things', credits: 15 },
        { code: 'CS5054', title: 'Advanced Programming and Technologies', credits: 15 },
        { code: 'CS5071', title: 'Professional and Ethical Issues', credits: 15 },
        { code: 'CC5067', title: 'Smart Data Discovery', credits: 15 },
      ],
      [
        { code: 'CU6051', title: 'Artificial Intelligence', credits: 15 },
        { code: 'CC6012', title: 'Data and Web Development', credits: 30 },
        { code: 'CS6004', title: 'Application Development', credits: 30 },
        { code: 'CS6W50', title: 'Career Development Learning', credits: 15 },
        { code: 'CS6P05', title: 'Project', credits: 30 },
      ],
    ],
    BSCAI: [
      [
        { code: 'MA4010', title: 'Calculus and Linear Algebra', credits: 30 },
        { code: 'CC4057', title: 'Introduction to Information Systems', credits: 15 },
        { code: 'CC4051', title: 'Fundamentals of Computing', credits: 15 },
        { code: 'CS4051', title: 'Fundamentals of Robotics and IoT', credits: 30 },
        { code: 'CS4001', title: 'Programming', credits: 30 },
      ],
      [
        { code: 'CS5003', title: 'Data Structure and Specialist Programming', credits: 30 },
        { code: 'MA5053', title: 'Probability and Statistics', credits: 15 },
        { code: 'MA5054', title: 'Further Calculus', credits: 15 },
        { code: 'CC5061', title: 'Applied Data Science', credits: 15 },
        { code: 'CS5002', title: 'Software Engineering', credits: 30 },
        { code: 'CC5051', title: 'Databases', credits: 15 },
      ],
      [
        { code: 'CT6008', title: 'Big Data and Data Mining', credits: 30 },
        { code: 'CT6057', title: 'Computer Vision', credits: 15 },
        { code: 'CC6057', title: 'Applied Machine Learning', credits: 15 },
        { code: 'CU6051', title: 'Artificial Intelligence', credits: 15 },
        { code: 'CS6P05', title: 'Project', credits: 30 },
        { code: 'CS6W50', title: 'Career Development Learning', credits: 15 },
      ],
    ],
    BSCNIS: [
      [
        { code: 'CC4005', title: 'Introduction to Networks', credits: 30 },
        { code: 'CC4058', title: 'Introduction to Information Systems', credits: 15 },
        { code: 'CC4059', title: 'Fundamentals of Computing', credits: 15 },
        { code: 'CC4004', title: 'Cybersecurity Fundamentals', credits: 30 },
        { code: 'CS4001', title: 'Programming', credits: 30 },
      ],
      [
        { code: 'CT5009', title: 'Switching Routing and Wireless Essentials', credits: 30 },
        { code: 'CC5052', title: 'Risk, Crisis and Security Management', credits: 15 },
        { code: 'CC5068', title: 'Cloud Computing and the Internet of Things', credits: 15 },
        { code: 'CC5009', title: 'Cybersecurity in Computing', credits: 30 },
        { code: 'CT5054', title: 'Operating Systems', credits: 15 },
        { code: 'CS5071', title: 'Professional and Ethical Issues', credits: 15 },
      ],
      [
        { code: 'CT6009', title: 'Enterprise Networking Security and Automation', credits: 30 },
        { code: 'CC6051', title: 'Ethical Hacking', credits: 15 },
        { code: 'CC6011', title: 'Digital Investigation and E-Discovery', credits: 30 },
        { code: 'CS6W50', title: 'Career Development Learning', credits: 15 },
        { code: 'CS6P05', title: 'Project', credits: 30 },
      ],
    ],
    BSCMT: [
      [
        { code: 'CU4051', title: '3D Modelling and Texturing', credits: 15 },
        { code: 'CU4052', title: '3D Sculpting and Animation', credits: 15 },
        { code: 'CU4060', title: 'Introduction to Drawing and Animation', credits: 15 },
        { code: 'CU4050', title: '2D Computer Animation', credits: 15 },
        { code: 'CU4062', title: 'Digital Imaging', credits: 15 },
        { code: 'MD4056', title: 'Post-Production', credits: 15 },
        { code: 'CC4057', title: 'Information System', credits: 15 },
        { code: 'MD4053', title: 'Sound Design for Linear Media', credits: 15 },
      ],
      [
        { code: 'CU5059', title: 'Anatomy and Character VFX', credits: 15 },
        { code: 'CU5050', title: '3D Texturing and VFX', credits: 15 },
        { code: 'CU5055', title: 'Advanced 3D Animation', credits: 15 },
        { code: 'CU5056', title: 'Advanced 3D Modelling', credits: 15 },
        { code: 'CU5062', title: 'Motion Graphics Design', credits: 15 },
        { code: 'CU5065', title: 'VFX', credits: 15 },
        { code: 'SM5088', title: 'Digital Project Management', credits: 15 },
        { code: 'SM5094', title: 'Web Design', credits: 15 },
      ],
      [
        { code: 'MD6051', title: 'Advanced Studio Engineering', credits: 15 },
        { code: 'MD6053', title: 'Audio Mastering and Remastering', credits: 15 },
        { code: 'CU6068', title: 'Portfolio Research, Design and Social Media', credits: 15 },
        { code: 'CU6012', title: 'Portfolio Creation', credits: 15 },
        { code: 'CS6P05', title: 'Project', credits: 30 },
        { code: 'SM6082', title: 'Media Industry Careers', credits: 15 },
        { code: 'CS6W50', title: 'Career Development Learning', credits: 15 },
      ],
    ],
    BABA: [
      [
        { code: 'AC4053', title: 'Managing Accounting Fundamentals', credits: 15 },
        { code: 'MN4079', title: 'People Management and Organisations', credits: 15 },
        { code: 'MC4061', title: 'Principles of Marketing', credits: 15 },
        { code: 'MN4083', title: 'Data Analysis for Business Decision Making', credits: 15 },
        { code: 'AC4052', title: 'Financial Accounting', credits: 15 },
        { code: 'FE4055', title: 'Understanding the Business and Economic Environment', credits: 15 },
        { code: 'MN4084', title: 'Learning Through Organisations', credits: 15 },
        { code: 'HR4056', title: 'Introduction to HRM in Contemporary Organisations', credits: 15 },
      ],
      [
        { code: 'MN5067', title: 'Leadership in Practice', credits: 15 },
        { code: 'MC5080', title: 'Marketing Communications', credits: 15 },
        { code: 'LT5078', title: 'Sustainability, Business and Responsibility', credits: 15 },
        { code: 'MN5055', title: 'Project Management', credits: 15 },
        { code: 'BL5055', title: 'Company and Business Law', credits: 15 },
        { code: 'MN5075', title: 'Operations & Supply Chain Management', credits: 15 },
        { code: 'AC5063', title: 'Principles of Finance', credits: 15 },
        { code: 'HR5053', title: 'Organisation Design and Management', credits: 15 },
      ],
      [
        { code: 'MN6P07', title: 'Dissertation', credits: 30 },
        { code: 'FE6006', title: 'International Business Environment and World Markets', credits: 30 },
        { code: 'FE6063', title: 'Economics of Multinational Business', credits: 15 },
        { code: 'MN6090', title: 'International Marketing and Sales in the Digital Era', credits: 15 },
        { code: 'EC6065', title: 'International Trade and Finance', credits: 15 },
        { code: 'MN6093', title: 'International Business Strategy', credits: 15 },
      ],
    ],
    BAAF: [
      [
        { code: 'AC4052', title: 'Financial Accounting', credits: 15 },
        { code: 'AC4053', title: 'Management Accounting Fundamentals', credits: 15 },
        { code: 'AC4054', title: 'Management Information Systems', credits: 15 },
        { code: 'AC4055', title: 'Data Science, Research and Analysis', credits: 15 },
        { code: 'AC4056', title: 'Business Law and Ethics', credits: 15 },
        { code: 'FE4055', title: 'Understanding the Business and Economic Environment', credits: 15 },
        { code: 'FE4051', title: 'Introduction to Financial Markets and Institutions', credits: 15 },
        { code: 'MN4084', title: 'Learning Through Organisations', credits: 15 },
      ],
      [
        { code: 'AC5062', title: 'Financial Reporting', credits: 15 },
        { code: 'AC5063', title: 'Principles of Finance', credits: 15 },
        { code: 'AC5064', title: 'Taxation - Income Tax', credits: 15 },
        { code: 'AC5065', title: 'Taxation - Corporate Tax', credits: 15 },
        { code: 'AC5072', title: 'Performance Management', credits: 15 },
        { code: 'BL5055', title: 'Company and Business Law', credits: 15 },
        { code: 'FE5056', title: 'Problem Solving: Methods and Analysis', credits: 15 },
        { code: 'MN5W50', title: 'Creating a Winning Business', credits: 15 },
      ],
      [
        { code: 'AC6064', title: 'Advanced Financial Reporting', credits: 15 },
        { code: 'AC6065', title: 'Financial Management', credits: 15 },
        { code: 'AC6068', title: 'Audit and Assurance Services', credits: 15 },
        { code: 'AC6070', title: 'Advanced Financial Accounting', credits: 15 },
        { code: 'FE6055', title: 'Financial and Economic Modelling', credits: 15 },
        { code: 'FE6060', title: 'Financial Engineering', credits: 15 },
        { code: 'FE6P04A', title: 'Dissertation', credits: 15 },
        { code: 'FE6P04S', title: 'Dissertation', credits: 15 },
      ],
    ],
  };

  const leadersByYear = [leaderCS.id, leaderCS2.id, leaderBM.id];
  // Two teachers per module, taken from the faculty in turn so the load is spread evenly.
  let staffCursor = 0;
  const teacherPairFor = new Map<string, [string, string]>();
  const pairFor = (programme: string, code: string): [string, string] => {
    const key = `${programme}:${code}`;
    const found = teacherPairFor.get(key);
    if (found) return found;
    // Walk the faculty from opposite ends, so the second teacher of a module is never the first
    // teacher of the module next to it and nobody ends up with three modules to cover.
    const n = faculty.length;
    const a = faculty[staffCursor % n].id;
    const b = faculty[(staffCursor + Math.floor(n / 2)) % n].id;
    staffCursor += 1;
    const pair: [string, string] = [a, b];
    teacherPairFor.set(key, pair);
    return pair;
  };
  /** Split a published year list across its two semesters, keeping the credit load even. */
  const modulesByProgramme: Record<string, { code: string; title: string; credits: number; sem: number; leader: string; teachers: [string, string]; comps: ComponentSpec[] }[]> = Object.fromEntries(
    Object.entries(CATALOGUE).map(([code, years]) => [
      code,
      years.flatMap((mods, yi) => {
        // Balance the year's credits across its two semesters (a year is 120 credits, so 60 each).
        const half = mods.reduce((n, m) => n + m.credits, 0) / 2;
        let first = 0;
        return mods.map((m) => {
          const toFirst = first + m.credits <= half;
          if (toFirst) first += m.credits;
          return {
            code: m.code,
            title: m.title,
            credits: m.credits,
            sem: yi * 2 + (toFirst ? 1 : 2),
            leader: code.startsWith('BSC') ? leadersByYear[yi] : leaderBM.id,
            teachers: pairFor(code, m.code),
            comps: m.credits >= 30 ? three() : cw60ex40(),
          };
        });
      }),
    ]),
  );

  // The hero-demo pipeline states for the Sep 2025 intake, semester 2.
  // Semester-2 modules of the Sep 2025 intakes carry the live result pipeline for the demo.
  const pipelineState: Record<string, MarkSheetStatus | 'EMPTY_DRAFT'> = {
    CT4005: 'EMPTY_DRAFT', // lecturer@demo imports the CSV live
    CS4001: 'SUBMITTED', // waiting for leader@demo
    AC4052: 'UNDER_REVIEW',
    FE4055: 'APPROVED', // admin publishes live
  };
  // Lecturer assignment: lecturer@demo teaches CS4003 and CS4004 for the Sep 2025 intake, and CS4001 for Sep 2026.
  const lecturerFor = (code: string, intakeLabel: string): string | null => {
    if ((code === 'CT4005' || code === 'CS4001') && intakeLabel === 'Sep 2025') return lecturer.id;
    if (code === 'CS4001' && intakeLabel === 'Sep 2026') return lecturer.id;
    return null; // otherwise the module's own two teachers take it
  };

  let studentSeq = 0;
  const demoStudentEmails = ['student1@demo', 'student2@demo', 'student3@demo', 'student4@demo', 'student5@demo'];
  let demoIdx = 0;
  const usedNames = new Set<string>();
  const nextName = () => {
    let n = '';
    do n = `${pick(FIRST)} ${pick(LAST)}`;
    while (usedNames.has(n) && usedNames.size < FIRST.length * LAST.length - 5);
    usedNames.add(n);
    return n;
  };

  const allStudents: { id: string; studentId: string; name: string; userId: string | null; programme: string; intakeLabel: string }[] = [];
  const sectionsByIntake = new Map<string, { id: string; name: string; size: number }[]>();
  const currentSemesters: { id: string; intakeId: string; start: Date; end: Date; examStart: Date; examEnd: Date; label: string }[] = [];
  const offeringsAll: { id: string; code: string; credits: number; sem: number; intakeLabel: string; programme: string; comps: { id: string; name: string; weight: number; maxMark: number; componentPassMark: number | null }[]; moduleId: string; semesterId: string; lecturerId: string; teacherIds: string[] }[] = [];
  const auditRows: { actorId: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason?: string | null; createdAt: Date }[] = [];

  for (const p of programmes) {
    const programme = await prisma.programme.create({ data: { code: p.code, name: p.name, level: p.level } });
    const modules = new Map<string, { id: string; sem: number; credits: number; teachers: [string, string]; comps: ComponentSpec[] }>();
    for (const m of modulesByProgramme[p.code]) {
      const mod = await prisma.module.create({ data: { code: m.code, title: m.title, credits: m.credits, semesterNumber: m.sem, programmeId: programme.id, moduleLeaderId: m.leader } });
      modules.set(m.code, { id: mod.id, sem: m.sem, credits: m.credits, teachers: m.teachers, comps: m.comps });
    }

    for (const it of p.history ? intakes : intakes.filter((i) => i.label === 'Sep 2026')) {
      const intake = await prisma.intake.create({ data: { programmeId: programme.id, label: it.label, startDate: date(it.year, 9, 15) } });
      const semesters: { id: string; number: number; end: Date; start: Date; examStart: Date }[] = [];
      for (let n = 1; n <= it.semesters; n++) {
        const w = semWindow(it.year, n);
        const s = await prisma.semester.create({
          data: { intakeId: intake.id, number: n, term: w.term, startDate: w.start, endDate: w.end, teachingWeeks: 12, examStart: w.examStart, examEnd: w.examEnd },
        });
        semesters.push({ id: s.id, number: n, end: w.end, start: w.start, examStart: w.examStart });
      }
      const current = semesters[semesters.length - 1];
      const cw = semWindow(it.year, current.number);
      currentSemesters.push({ id: current.id, intakeId: intake.id, start: cw.start, end: cw.end, examStart: cw.examStart, examEnd: cw.examEnd, label: `${p.code} ${it.label} S${current.number}` });

      // 8 sections of 20 (A … H)
      const size = COHORT_SIZE;
      const groupName = (i: number) => `${GROUP_PREFIX[p.code] ?? 'G'}${i + 1}`;
      const sections = Array.from({ length: SECTIONS_PER_INTAKE }, () => randomUUID());
      await prisma.section.createMany({ data: sections.map((id, s) => ({ id, intakeId: intake.id, name: groupName(s) })) });
      sectionsByIntake.set(intake.id, sections.map((id, i) => ({ id, name: groupName(i), size: SECTION_SIZE })));

      // Students are written in bulk: 160 per intake is far too many round trips one at a time.
      const cohort: typeof allStudents = [];
      const userRows: { id: string; email: string; name: string; role: Role; passwordHash: string }[] = [];
      const studentRows: Record<string, unknown>[] = [];
      const feeRows: Record<string, unknown>[] = [];
      for (let i = 0; i < size; i++) {
        studentSeq += 1;
        const name = nextName();
        const studentId = `${String(it.year).slice(2)}${p.idPrefix}${String(i + 1).padStart(4, '0')}`;
        // demo logins: first 5 students of Sep 2025 Computing; everyone else gets <id>@student.demo
        let email = `${studentId}@student.demo`;
        if (p.code === 'BSCC' && it.label === 'Sep 2025' && demoIdx < demoStudentEmails.length) email = demoStudentEmails[demoIdx++];
        const displayName = email === 'student1@demo' ? 'Dipesh Karki' : name;
        const userId = randomUUID();
        const sid = randomUUID();
        userRows.push({ id: userId, email, name: displayName, role: 'STUDENT' as Role, passwordHash });
        studentRows.push({
          id: sid,
          studentId,
          name: displayName,
          email,
          programmeId: programme.id,
          intakeId: intake.id,
          sectionId: sections[i % SECTIONS_PER_INTAKE], // round-robin keeps every section exactly 20
          currentSemesterId: current.id,
          userId,
          status: 'ACTIVE',
          specialNeedsSeating: rand() < 0.06,
        });
        // semester fee for the current semester: most have paid; a few (incl. student1) have not — the admit-card demo
        const paid = email === 'student1@demo' ? false : rand() < 0.8;
        feeRows.push({
          studentId: sid,
          semesterId: current.id,
          amount: 85000,
          currency: 'NPR',
          status: paid ? 'PAID' : 'UNPAID',
          dueDate: new Date(current.start.getTime() + 4 * week),
          paidAt: paid ? new Date(current.start.getTime() - randInt(1, 20) * 86400e3) : null,
          method: paid ? pick(['eSewa', 'Khalti', 'Bank transfer', 'Cash']) : null,
          reference: paid ? `RCPT-${studentId}-${current.number}` : null,
        });
        const rec = { id: sid, studentId, name: displayName, userId, programme: p.code, intakeLabel: it.label };
        cohort.push(rec);
        allStudents.push(rec);
      }
      await prisma.user.createMany({ data: userRows });
      await prisma.student.createMany({ data: studentRows as never });
      await prisma.feeInvoice.createMany({ data: feeRows as never });

      // offerings for every semester so far
      for (const sem of semesters) {
        for (const [code, m] of modules) {
          if (m.sem !== sem.number) continue;
          // The module's two teachers; a demo override can put lecturer@demo in the lead seat.
          const override = lecturerFor(code, it.label);
          const teacherIds = override ? [override, m.teachers.find((x) => x !== override) ?? m.teachers[1]] : [...m.teachers];
          const lecturerId = teacherIds[0];
          const offering = await prisma.moduleOffering.create({
            data: {
              moduleId: m.id,
              semesterId: sem.id,
              lecturerId,
              coLecturerId: teacherIds[1],
              components: { create: m.comps.map((c, i) => ({ name: c.name, weight: c.weight, maxMark: c.maxMark, componentPassMark: c.componentPassMark ?? null, sortOrder: i })) },
            },
            include: { components: { orderBy: { sortOrder: 'asc' } } },
          });
          offeringsAll.push({ id: offering.id, code, credits: m.credits, sem: sem.number, intakeLabel: it.label, programme: p.code, comps: offering.components, moduleId: m.id, semesterId: sem.id, lecturerId, teacherIds });

          // enrol the cohort (one statement — 160 students per offering)
          const enrollments = cohort.map((st) => ({ id: randomUUID(), studentId: st.id, attempt: 1, isResit: false }));
          await prisma.enrollment.createMany({ data: enrollments.map((e) => ({ id: e.id, studentId: e.studentId, moduleOfferingId: offering.id, attempt: 1, isResit: false })) });

          // decide the sheet state for this offering
          let state: MarkSheetStatus | 'EMPTY_DRAFT' | 'NONE' = 'NONE';
          if (sem.number <= it.published) state = 'PUBLISHED';
          else if (it.inPipeline === sem.number) state = pipelineState[code] ?? 'DRAFT';
          if (state === 'NONE') continue;

          const specs: ComponentSpec[] = offering.components.map((c) => ({ id: c.id, name: c.name, weight: c.weight, maxMark: c.maxMark, componentPassMark: c.componentPassMark }));
          const sheetTimes = timeline(sem.end, state);
          const sheet = await prisma.markSheet.create({
            data: {
              moduleOfferingId: offering.id,
              status: state === 'EMPTY_DRAFT' ? 'DRAFT' : state,
              version: 1,
              gradingSchemeId: scheme.id,
              submittedById: sheetTimes.submittedAt ? lecturerId : null,
              submittedAt: sheetTimes.submittedAt,
              approvedById: sheetTimes.approvedAt ? modulesByProgramme[p.code].find((x) => x.code === code)!.leader : null,
              approvedAt: sheetTimes.approvedAt,
              publishedById: sheetTimes.publishedAt ? admin.id : null,
              publishedAt: sheetTimes.publishedAt,
              lockVersion: sheetTimes.lock,
              createdAt: sheetTimes.createdAt,
              updatedAt: sheetTimes.updatedAt,
            },
          });
          auditRows.push({ actorId: lecturerId, action: 'marksheet.create', entityType: 'MarkSheet', entityId: sheet.id, after: { version: 1 }, createdAt: sheetTimes.createdAt });
          if (state === 'EMPTY_DRAFT') continue;

          // marks: ability per student (stable across modules via a hash of the id)
          const cohortBias = it.label === 'Sep 2024' && code === 'CC4057' ? 22 : 0; // makes a "mean shift" flag on the next offering
          const rows: { enrollmentId: string; attempt: number; isResit: boolean; marks: { componentId: string; rawMark: number | null; isAbsent: boolean }[] }[] = [];
          for (const e of enrollments) {
            const ability = clamp(gauss(56 + cohortBias, 13), 12, 96);
            const marks = specs.map((c) => {
              if (rand() < 0.02) return { componentId: c.id, rawMark: null, isAbsent: true };
              const pctv = clamp(gauss(ability, 9), 0, 100);
              return { componentId: c.id, rawMark: Math.round((pctv / 100) * c.maxMark * 2) / 2, isAbsent: false };
            });
            rows.push({ enrollmentId: e.id, attempt: e.attempt, isResit: e.isResit, marks });
          }
          // data-quality issue: one published sheet with a student missing a mark (never validated because it was "migrated")
          if (state === 'PUBLISHED' && code === 'MC4061' && it.label === 'Sep 2025') rows[3].marks[1] = { componentId: specs[1].id, rawMark: null, isAbsent: false };

          await prisma.mark.createMany({ data: rows.flatMap((r) => r.marks.map((m) => ({ markSheetId: sheet.id, enrollmentId: r.enrollmentId, componentId: m.componentId, rawMark: m.rawMark, isAbsent: m.isAbsent }))) });
          auditRows.push({ actorId: lecturerId, action: 'import.commit', entityType: 'MarkSheet', entityId: sheet.id, after: { fileName: `${code}-${it.label.replace(' ', '')}.xlsx`, rowsCommitted: rows.length }, createdAt: new Date(sheetTimes.createdAt.getTime() + 3600e3) });

          // results for anything past DRAFT
          if (state !== 'DRAFT') {
            const results = rows
              .filter((r) => r.marks.every((m) => m.isAbsent || m.rawMark !== null))
              .map((r) => {
                const g = computeGrade({ components: specs, marks: r.marks, scheme: { passMark: 40, resitCap: 40, bands: scheme.bands as never }, attempt: r.attempt, isResit: r.isResit });
                return { enrollmentId: r.enrollmentId, markSheetId: sheet.id, markSheetVersion: 1, overallMark: g.overallMark, grade: g.grade, outcome: g.outcome, computedAt: sheetTimes.submittedAt ?? sheetTimes.createdAt };
              });
            await prisma.result.createMany({ data: results });
            if (sheetTimes.submittedAt) auditRows.push({ actorId: lecturerId, action: 'marksheet.submit', entityType: 'MarkSheet', entityId: sheet.id, before: { status: 'DRAFT' }, after: { status: 'SUBMITTED' }, createdAt: sheetTimes.submittedAt });
            if (sheetTimes.reviewAt) auditRows.push({ actorId: modulesByProgramme[p.code].find((x) => x.code === code)!.leader, action: 'marksheet.start_review', entityType: 'MarkSheet', entityId: sheet.id, before: { status: 'SUBMITTED' }, after: { status: 'UNDER_REVIEW' }, createdAt: sheetTimes.reviewAt });
            if (sheetTimes.approvedAt) auditRows.push({ actorId: modulesByProgramme[p.code].find((x) => x.code === code)!.leader, action: 'marksheet.approve', entityType: 'MarkSheet', entityId: sheet.id, before: { status: 'UNDER_REVIEW' }, after: { status: 'APPROVED' }, createdAt: sheetTimes.approvedAt });
            if (sheetTimes.publishedAt) auditRows.push({ actorId: admin.id, action: 'marksheet.publish', entityType: 'MarkSheet', entityId: sheet.id, before: { status: 'APPROVED' }, after: { status: 'PUBLISHED' }, createdAt: sheetTimes.publishedAt });

            // resits: for published sheets, RESIT outcomes get a second attempt, graded and published too
            if (state === 'PUBLISHED') {
              const resitters = results.filter((r) => r.outcome === 'RESIT');
              const resitEnrolments: { id: string; studentId: string; moduleOfferingId: string; attempt: number; isResit: boolean }[] = [];
              const resitMarks: { markSheetId: string; enrollmentId: string; componentId: string; rawMark: number; isAbsent: boolean }[] = [];
              const resitResults: Record<string, unknown>[] = [];
              for (const r of resitters) {
                const orig = enrollments.find((e) => e.id === r.enrollmentId)!;
                const e2 = randomUUID();
                resitEnrolments.push({ id: e2, studentId: orig.studentId, moduleOfferingId: offering.id, attempt: 2, isResit: true });
                const passesResit = rand() < 0.7;
                const marks = specs.map((c) => ({ componentId: c.id, rawMark: clamp(Math.round(((passesResit ? gauss(52, 6) : gauss(30, 6)) / 100) * c.maxMark * 2) / 2, 0, c.maxMark), isAbsent: false }));
                resitMarks.push(...marks.map((m) => ({ markSheetId: sheet.id, enrollmentId: e2, componentId: m.componentId, rawMark: m.rawMark, isAbsent: false })));
                const g = computeGrade({ components: specs, marks, scheme: { passMark: 40, resitCap: 40, bands: scheme.bands as never }, attempt: 2, isResit: true });
                resitResults.push({ enrollmentId: e2, markSheetId: sheet.id, markSheetVersion: 1, overallMark: g.overallMark, grade: g.grade, outcome: g.outcome, computedAt: sheetTimes.publishedAt ?? new Date() });
              }
              if (resitEnrolments.length) {
                await prisma.enrollment.createMany({ data: resitEnrolments });
                await prisma.mark.createMany({ data: resitMarks });
                await prisma.result.createMany({ data: resitResults as never });
              }
            }
          }
        }
      }
    }
  }

  // ---------- a correction cycle: Sep 2024 CS5004 v1 published → correction requested → v2 draft ----------
  // A published Sep 2024 Computing module gets the correction cycle (published -> correction -> v2 draft).
  const corr = offeringsAll.find((o) => o.intakeLabel === 'Sep 2024' && o.programme === 'BSCC' && o.sem === 4)!;
  const v1 = corr ? await prisma.markSheet.findFirst({ where: { moduleOfferingId: corr.id, version: 1 }, include: { marks: true } }) : null;
  if (v1) {
    await prisma.markSheet.update({ where: { id: v1.id }, data: { status: 'CORRECTION_REQUESTED', lockVersion: { increment: 1 } } });
    const v2 = await prisma.markSheet.create({ data: { moduleOfferingId: corr.id, version: 2, status: 'DRAFT', gradingSchemeId: scheme.id } });
    await prisma.mark.createMany({ data: v1.marks.map((m) => ({ markSheetId: v2.id, enrollmentId: m.enrollmentId, componentId: m.componentId, rawMark: m.rawMark, isAbsent: m.isAbsent })) });
    auditRows.push({ actorId: admin.id, action: 'marksheet.request_correction', entityType: 'MarkSheet', entityId: v1.id, before: { status: 'PUBLISHED' }, after: { status: 'CORRECTION_REQUESTED' }, reason: 'Coursework mark for 24010007 transposed (57 entered as 75)', createdAt: date(2026, 9, 10, 14) });
    auditRows.push({ actorId: corr.lecturerId, action: 'marksheet.create', entityType: 'MarkSheet', entityId: v2.id, after: { version: 2, copiedFrom: v1.id }, createdAt: date(2026, 9, 10, 15) });
  }

  // ---------- standing from published results ----------
  {
    // One pass over every published result, then three bulk updates — a query per student would
    // be thousands of round trips.
    const published = await prisma.result.findMany({
      where: { markSheet: { status: 'PUBLISHED' } },
      select: { outcome: true, enrollment: { select: { studentId: true, moduleOfferingId: true, attempt: true } } },
    });
    const latest = new Map<string, Map<string, { attempt: number; outcome: string }>>();
    for (const r of published) {
      const byOffering = latest.get(r.enrollment.studentId) ?? new Map<string, { attempt: number; outcome: string }>();
      const cur = byOffering.get(r.enrollment.moduleOfferingId);
      if (!cur || r.enrollment.attempt > cur.attempt) byOffering.set(r.enrollment.moduleOfferingId, { attempt: r.enrollment.attempt, outcome: r.outcome });
      latest.set(r.enrollment.studentId, byOffering);
    }
    const buckets: Record<string, string[]> = { GOOD: [], RESIT: [], REVIEW: [] };
    for (const st of allStudents) {
      const outcomes = [...(latest.get(st.id)?.values() ?? [])].map((x) => x.outcome);
      const resits = outcomes.filter((o) => o === 'RESIT').length;
      // Same rule as services/results.ts refreshStanding: any FAIL or 2+ modules outstanding → REVIEW.
      buckets[outcomes.includes('FAIL') || resits >= 2 ? 'REVIEW' : resits === 1 ? 'RESIT' : 'GOOD'].push(st.id);
    }
    for (const [standing, ids] of Object.entries(buckets)) {
      if (ids.length) await prisma.student.updateMany({ where: { id: { in: ids } }, data: { standing: standing as never } });
    }
  }

  // ---------- deliberate data-quality issues ----------
  const dq = allStudents.filter((s) => s.intakeLabel === 'Sep 2024' && s.programme === 'BABA');
  await prisma.student.update({ where: { id: dq[0].id }, data: { currentSemesterId: null } }); // no current semester
  await prisma.student.update({ where: { id: dq[1].id }, data: { currentSemesterId: null, status: 'DEFERRED' } });
  const wrongIntake = await prisma.intake.findFirst({ where: { label: 'Sep 2025', programme: { code: 'BSCC' } } });
  await prisma.student.update({ where: { id: dq[2].id }, data: { intakeId: wrongIntake!.id } }); // intake belongs to another programme
  await prisma.student.update({ where: { id: dq[3].id }, data: { status: 'WITHDRAWN' } });
  await prisma.student.update({ where: { id: dq[4].id }, data: { status: 'WITHDRAWN', deletedAt: date(2026, 3, 1) } });

  // ---------- venues & exam sessions ----------
  const lb101 = await prisma.venue.create({ data: { name: 'LB-101', building: 'London Block', rows: 8, cols: 10, adjacencyMode: 'ROW_AND_COLUMN', disabledSeats: [{ row: 1, col: 10 }, { row: 8, col: 1 }] } });
  const kumari = await prisma.venue.create({ data: { name: 'Kumari Hall', building: 'Main Block', rows: 12, cols: 14, adjacencyMode: 'ROW', disabledSeats: [{ row: 6, col: 7 }, { row: 6, col: 8 }, { row: 12, col: 14 }], isClassroom: false } });
  const lab3 = await prisma.venue.create({ data: { name: 'Lab 3', building: 'London Block', rows: 5, cols: 8, adjacencyMode: 'ROW_AND_COLUMN', disabledSeats: [] } });
  /**
   * The teaching estate, named as Islington's own allocation sheet names it: blocks (Kumari,
   * Alumni, Nepal, Skill, London, A Level) holding halls, lecture theatres, seminar rooms,
   * tutorial rooms and labs. The room type is what decides where a class can go — a lecture needs
   * a hall, a workshop a lab — so it is stored rather than inferred from the name.
   */
  type RoomSpec = { name: string; building: string; roomType: 'HALL' | 'LECTURE_THEATRE' | 'TUTORIAL_ROOM' | 'SEMINAR_ROOM' | 'LAB'; rows: number; cols: number };
  const estate: RoomSpec[] = [
    { name: 'Hall - 01', building: 'Kumari', roomType: 'HALL', rows: 14, cols: 16 },
    { name: 'Hall - 02', building: 'Kumari', roomType: 'HALL', rows: 14, cols: 16 },
    ...['Tridev Gurung', 'Amir Khadka', 'Chhitesh Lal Shrestha', 'Naresh Lamgade'].map((who, i) => ({ name: `LT0${i + 4} - ${who}`, building: 'Alumni', roomType: 'LECTURE_THEATRE' as const, rows: 12, cols: 15 })),
    ...['Buckingham Palace', 'Kensington Palace', 'Westminster Palace'].map((who, i) => ({ name: `LT0${i + 1} - ${who}`, building: 'London', roomType: 'LECTURE_THEATRE' as const, rows: 12, cols: 15 })),
    ...['LT - 11', 'LT - 12', 'LT - 13'].map((name) => ({ name, building: 'A Level', roomType: 'LECTURE_THEATRE' as const, rows: 12, cols: 15 })),
    ...['Sajiya Gurung', 'Simran Bhattarai', 'Samir Gautam', 'Rotash Shrestha', 'Anish Thapa', 'Nirajan Basnet'].map((who, i) => ({ name: `SR0${i + 5} - ${who}`, building: 'Alumni', roomType: 'SEMINAR_ROOM' as const, rows: 5, cols: 6 })),
    ...['Tower Bridge', 'Trafalgar Square', 'Piccadilly Circus'].map((who, i) => ({ name: `SR0${i + 1} - ${who}`, building: 'London', roomType: 'SEMINAR_ROOM' as const, rows: 5, cols: 6 })),
    ...['Kantipur', 'Patan', 'Pokhara', 'Lumbini', 'Machapuchare', 'Annapurna', 'Kanchanjunga'].map((who, i) => ({ name: `TR0${i + 1} - ${who}`, building: 'Nepal', roomType: 'TUTORIAL_ROOM' as const, rows: 5, cols: 6 })),
    ...Array.from({ length: 8 }, (_, i) => ({ name: `TR - ${i + 10}`, building: 'A Level', roomType: 'TUTORIAL_ROOM' as const, rows: 5, cols: 6 })),
    ...['Sarun Dahal', 'Sangay Lama', 'Srijan Ghimire', 'Prajwol Adhikari', 'Pratima Giri', 'Anew Karki', 'Rupesh Dangol', 'Vijay Pathak', 'Shishir Tamrakar', 'Pranjal Deep Kane', 'Dorjee Khando Lama', 'Jagaran Maharjan'].map((who, i) => ({ name: `Lab ${String(i + 1).padStart(2, '0')} - ${who}`, building: 'Skill', roomType: 'LAB' as const, rows: 5, cols: 5 })),
  ];
  await prisma.venue.createMany({
    data: estate.map((r) => ({ name: r.name, building: r.building, roomType: r.roomType, rows: r.rows, cols: r.cols, adjacencyMode: 'ROW' as const, disabledSeats: [], isClassroom: true })),
  });
  await prisma.venue.create({ data: { name: 'Auditorium', building: 'Main Block', rows: 15, cols: 16, adjacencyMode: 'ROW', disabledSeats: [], isClassroom: false } });

  const sem2Offerings = offeringsAll.filter((o) => o.intakeLabel === 'Sep 2025' && o.sem === 2);
  const s1Offerings = offeringsAll.filter((o) => o.intakeLabel === 'Sep 2026' && o.sem === 1 && ['AC4053', 'CC4005'].includes(o.code));
  await prisma.examSession.create({
    data: {
      title: 'Semester 2 Resit Exams - Computing Architecture & Financial Accounting',
      kind: 'RESIT',
      date: date(2026, 9, 19),
      startTime: '09:00',
      durationMin: 120,
      seed: 7,
      semesterId: sem2Offerings[0]?.semesterId,
      offerings: { connect: sem2Offerings.filter((o) => ['CT4005', 'AC4052'].includes(o.code)).map((o) => ({ id: o.id })) },
      venues: { connect: [{ id: lb101.id }, { id: lab3.id }] },
      generatedBy: 'manual',
    },
  });
  const midterm = await prisma.examSession.create({
    data: {
      title: 'Class test - Managing Accounting Fundamentals & Introduction to Networks (Sep 2026 intake)',
      kind: 'CLASS_TEST',
      seatingMode: 'BY_ID',
      date: date(2026, 10, 24),
      startTime: '13:00',
      durationMin: 90,
      seed: 3,
      semesterId: s1Offerings[0]?.semesterId,
      offerings: { connect: s1Offerings.map((o) => ({ id: o.id })) },
      venues: { connect: [{ id: kumari.id }] },
      generatedBy: 'manual',
    },
  });
  // The mid-term is already seated (the resit session is left pending for the live demo).
  {
    const enrolments = await prisma.enrollment.findMany({
      where: { moduleOfferingId: { in: s1Offerings.map((o) => o.id) }, deletedAt: null },
      include: { student: { select: { id: true, studentId: true, name: true, specialNeedsSeating: true } }, moduleOffering: { select: { module: { select: { code: true } } } } },
    });
    const seating = generateSeating(
      [{ id: kumari.id, name: kumari.name, rows: kumari.rows, cols: kumari.cols, disabledSeats: kumari.disabledSeats as { row: number; col: number }[], adjacencyMode: kumari.adjacencyMode }],
      enrolments.map((e) => ({ studentId: e.student.id, label: e.student.studentId, name: e.student.name, offeringId: e.moduleOfferingId, moduleCode: e.moduleOffering.module.code, specialNeeds: e.student.specialNeedsSeating })),
      3,
    );
    await prisma.seatAllocation.createMany({
      data: seating.allocations.map((a) => ({ examSessionId: midterm.id, venueId: a.venueId, studentId: a.studentId, moduleOfferingId: a.offeringId, row: a.row, col: a.col, seatLabel: a.seatLabel, runId: 'seed-run-1' })),
    });
    auditRows.push({ actorId: admin.id, action: 'seating.generate', entityType: 'ExamSession', entityId: midterm.id, after: { runId: 'seed-run-1', seed: 3, seated: seating.allocations.length, unseated: seating.unseated.length, violations: seating.violations.length }, createdAt: date(2026, 9, 8, 11) });
  }

  // ---------- weekly routines for every semester now in progress (clash-free across all of them) ----------
  {
    const classrooms = await prisma.venue.findMany({ where: { isClassroom: true } });
    const rooms = classrooms.map((r) => ({ id: r.id, name: r.name, capacity: r.rows * r.cols, roomType: r.roomType }));
    const existing: ExistingBooking[] = [];
    let totalSlots = 0;
    for (const sem of currentSemesters) {
      const secs = sectionsByIntake.get(sem.intakeId) ?? [];
      const offs = offeringsAll.filter((o) => o.semesterId === sem.id);
      if (!secs.length || !offs.length) continue;
      const semNumber = Number(sem.label.split('S').pop());
      const finalYear = isFinalYearSemester(semNumber);
      const r = generateTimetable(
        secs.map((s) => ({ ...s, periods: periodsForSemester(semNumber), latestEnd: finalYear ? '10:00' : undefined, year: yearOfSemester(semNumber) })),
        offs.map((o) => ({ id: o.id, code: o.code, teacherId: o.lecturerId, teacherIds: o.teacherIds, credits: o.credits })),
        rooms,
        undefined,
        existing,
      );
      const slotIds = r.slots.map(() => randomUUID());
      await prisma.timetableSlot.createMany({ data: r.slots.map((s, i) => ({ id: slotIds[i], semesterId: sem.id, sectionId: s.sectionId, moduleOfferingId: s.offeringId, teacherId: s.teacherId, venueId: s.venueId, kind: s.kind as ClassKind, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, weekFrom: 1, weekTo: 12 })) });
      // The groups in the room: a lecture carries the whole cohort, an applied hour just its own.
      const pairs = r.slots.flatMap((s, i) => s.groupIds.map((g) => ({ A: g, B: slotIds[i] })));
      for (let i = 0; i < pairs.length; i += 500) {
        const chunk = pairs.slice(i, i + 500);
        await prisma.$executeRawUnsafe(`INSERT INTO "_SlotGroups" ("A","B") VALUES ${chunk.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2})`).join(',')} ON CONFLICT DO NOTHING`, ...chunk.flatMap((p) => [p.A, p.B]));
      }
      existing.push(...r.slots.map((s) => ({ teacherId: s.teacherId, venueId: s.venueId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime })));
      totalSlots += r.slots.length;
      if (r.unplaced.length) {
        const why = new Map<string, number>();
        for (const u of r.unplaced) why.set(u.reason, (why.get(u.reason) ?? 0) + 1);
        console.log(`seed:   ${sem.label}: ${r.slots.length} placed, ${r.unplaced.length} unplaced — ${[...why].map(([k, n]) => `${n}× ${k}`).join('; ')}`);
      }
      auditRows.push({ actorId: admin.id, action: 'timetable.generate', entityType: 'Semester', entityId: sem.id, after: { slots: r.slots.length, unplaced: r.unplaced.length }, createdAt: date(2026, 9, 7, 10) });
    }
    console.log(`seed: ${totalSlots} weekly timetable slots across ${currentSemesters.length} semesters`);
  }

  // ---------- final exam schedule for the Sep 2026 Computing cohort ("generated 3 weeks before the window") ----------
  {
    const sem = currentSemesters.find((s) => s.label === 'BSCC Sep 2026 S1');
    if (sem) {
      const offs = offeringsAll.filter((o) => o.semesterId === sem.id);
      const venues = await prisma.venue.findMany();
      const teachers = await prisma.user.findMany({ where: { role: { in: ['LECTURER', 'MODULE_LEADER'] } }, select: { id: true, name: true } });
      const counts = await Promise.all(offs.map((o) => prisma.enrollment.count({ where: { moduleOfferingId: o.id } })));
      const sched = generateExamSchedule(
        offs.map((o, i) => ({ id: o.id, code: o.code, semesterId: sem.id, candidates: counts[i], teacherId: o.lecturerId })),
        venues.map((v) => ({ id: v.id, name: v.name, capacity: v.rows * v.cols - ((v.disabledSeats as unknown[]) ?? []).length, examHall: !v.isClassroom })),
        teachers,
        examSlots(sem.examStart, sem.examEnd),
      );
      for (const s of sched.sessions) {
        const off = offs.find((o) => o.id === s.offeringIds[0])!;
        const title = modulesByProgramme.BSCC.find((m) => m.code === off.code)?.title ?? off.code;
        await prisma.examSession.create({
          data: { title: `Final exam — ${off.code} ${title} (BSCC Sep 2026, Sem 1)`, kind: 'FINAL', seatingMode: 'MIXED', semesterId: sem.id, date: s.date, startTime: s.startTime, durationMin: s.durationMin, generatedBy: 'auto', offerings: { connect: [{ id: off.id }] }, venues: { connect: s.venueIds.map((id) => ({ id })) }, invigilators: { create: s.invigilators } },
        });
      }
      auditRows.push({ actorId: null, action: 'exams.schedule', entityType: 'Semester', entityId: sem.id, after: { generatedBy: 'auto', sessions: sched.sessions.length }, createdAt: date(2026, 11, 16, 6) });
    }
  }

  // ---------- audit log + notifications ----------
  await prisma.auditLog.createMany({ data: auditRows.map((a) => ({ ...a, before: a.before as never, after: a.after as never })) });
  const dipesh = allStudents.find((s) => s.name === 'Dipesh Karki')!;
  await prisma.notification.createMany({
    data: [
      { userId: dipesh.userId!, type: 'result.published', title: 'MA4001 result published', body: 'Your Logic and Problem Solving result is now available.', payload: { module: 'MA4001' }, createdAt: date(2026, 2, 20), readAt: date(2026, 2, 21) },
      { userId: dipesh.userId!, type: 'result.published', title: 'CC4051 result published', body: 'Your Fundamentals of Computing result is now available.', payload: { module: 'CC4051' }, createdAt: date(2026, 2, 20) },
      { userId: leaderCS.id, type: 'marksheet.submitted', title: 'CS4001 marks submitted for review', body: 'Chetna Gurung submitted the CS4001 Programming mark sheet (v1).', payload: { module: 'CS4001' }, createdAt: date(2026, 9, 11, 16) },
      { userId: admin.id, type: 'marksheet.approved', title: 'FE4055 approved - ready to publish', body: 'Sarita Joshi approved the FE4055 mark sheet.', payload: { module: 'FE4055' }, createdAt: date(2026, 9, 11, 17) },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    students: await prisma.student.count(),
    modules: await prisma.module.count(),
    offerings: await prisma.moduleOffering.count(),
    enrollments: await prisma.enrollment.count(),
    markSheets: await prisma.markSheet.count(),
    marks: await prisma.mark.count(),
    results: await prisma.result.count(),
    venues: await prisma.venue.count(),
    examSessions: await prisma.examSession.count(),
    audit: await prisma.auditLog.count(),
  };
  console.log('seed: done', counts);
  console.log(`demo accounts: admin@demo, leader@demo, lecturer@demo, student1@demo … student5@demo (password ${DEMO_PASSWORD})`);
}

/** Plausible timestamps for a sheet in a given state, relative to the semester end. */
function timeline(semEnd: Date, state: MarkSheetStatus | 'EMPTY_DRAFT') {
  const day = 86400e3;
  const createdAt = new Date(semEnd.getTime() + 3 * day);
  const submittedAt = new Date(semEnd.getTime() + 12 * day);
  const reviewAt = new Date(semEnd.getTime() + 14 * day);
  const approvedAt = new Date(semEnd.getTime() + 16 * day);
  const publishedAt = new Date(semEnd.getTime() + 21 * day);
  const t = { createdAt, submittedAt: null as Date | null, reviewAt: null as Date | null, approvedAt: null as Date | null, publishedAt: null as Date | null, lock: 1, updatedAt: createdAt };
  const order: MarkSheetStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED'];
  const idx = state === 'EMPTY_DRAFT' ? 0 : order.indexOf(state === 'CORRECTION_REQUESTED' ? 'PUBLISHED' : state);
  if (idx >= 1) (t.submittedAt = submittedAt), (t.lock = 2), (t.updatedAt = submittedAt);
  if (idx >= 2) (t.reviewAt = reviewAt), (t.lock = 3), (t.updatedAt = reviewAt);
  if (idx >= 3) (t.approvedAt = approvedAt), (t.lock = 4), (t.updatedAt = approvedAt);
  if (idx >= 4) (t.publishedAt = publishedAt), (t.lock = 5), (t.updatedAt = publishedAt);
  return t;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
