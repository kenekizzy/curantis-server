import bcrypt from 'bcrypt';
import {
  PrismaClient,
  Role,
  UserStatus,
  WorkerType,
  VerificationStatus,
  CredentialStatus,
  AdminRole,
  BookingStatus,
  PaymentGateway,
  PaymentStatus,
  ReviewStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const HASH_COST = 10;

// Helper to compute timestamps relative to today
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86_400_000);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3_600_000);

// ─── Service Categories ────────────────────────────────────────────────────────

const serviceCategories = [
  { name: 'Elderly Care', description: 'Companion care, medication reminders, daily living support', isRestricted: false },
  { name: 'Special Needs Care', description: 'ASD, Cerebral Palsy, Down Syndrome, Developmental Disability support', isRestricted: false },
  { name: 'Post-Hospital Care', description: 'Recovery monitoring, mobility assistance, wound care support', isRestricted: true },
  { name: 'Nursing Care', description: 'Clinical care — IV, medication administration, medical monitoring', isRestricted: true },
  { name: 'Child Care Support', description: 'Specialised assistance for children with additional support needs', isRestricted: false },
  { name: 'Physiotherapy Assist', description: 'Mobility and rehabilitation support', isRestricted: false },
  { name: 'Overnight Care', description: 'Night-shift caregiving services', isRestricted: false },
  { name: 'Live-In Care', description: 'Long-term residential caregiving', isRestricted: true },
];

async function seedCategories() {
  console.log('  → Service categories');
  for (const cat of serviceCategories) {
    await prisma.serviceCategory.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }
}

// ─── Admins ───────────────────────────────────────────────────────────────────

async function seedAdmins() {
  console.log('  → Admin accounts');
  const adminHash = await bcrypt.hash('Admin1234!', HASH_COST);

  const admins = [
    { email: 'admin@curantis.ng', role: AdminRole.SUPER_ADMIN },
    { email: 'verifier@curantis.ng', role: AdminRole.VERIFICATION_OFFICER },
    { email: 'support@curantis.ng', role: AdminRole.SUPPORT_AGENT },
    { email: 'finance@curantis.ng', role: AdminRole.FINANCE_OFFICER },
  ];

  for (const a of admins) {
    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: {},
      create: {
        email: a.email,
        passwordHash: adminHash,
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });

    await prisma.adminProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, adminRole: a.role },
    });
  }
}

// ─── Clients ──────────────────────────────────────────────────────────────────

const clientsData = [
  {
    email: 'client@curantis.ng',
    phone: '+2348012345678',
    fullName: 'Ngozi Okafor',
    state: 'Lagos',
    lga: 'Victoria Island',
    careRecipientName: 'Chief Emmanuel Okafor',
    careRecipientAge: 78,
    careRecipientRel: 'Father',
    careNeedsSummary: 'Elderly father with mild dementia and hypertension. Requires daily medication reminders and mobility assistance.',
    emergencyName: 'Chukwuemeka Okafor',
    emergencyPhone: '+2348098765432',
  },
  {
    email: 'babatunde@curantis.ng',
    phone: '+2348022223333',
    fullName: 'Babatunde Adeleke',
    state: 'Lagos',
    lga: 'Ikeja',
    careRecipientName: 'Mrs. Folake Adeleke',
    careRecipientAge: 72,
    careRecipientRel: 'Mother',
    careNeedsSummary: 'Post-stroke recovery caregiving, stroke rehabilitation support and companionship.',
    emergencyName: 'Yinka Adeleke',
    emergencyPhone: '+2348033334444',
  },
  {
    email: 'amina@curantis.ng',
    phone: '+2348033335555',
    fullName: 'Amina Yusuf',
    state: 'Lagos',
    lga: 'Lekki',
    careRecipientName: 'Zainab Yusuf',
    careRecipientAge: 6,
    careRecipientRel: 'Daughter',
    careNeedsSummary: 'Autism Spectrum Disorder support, sensory activity assistance and afternoon care.',
    emergencyName: 'Tarik Yusuf',
    emergencyPhone: '+2348044446666',
  },
  {
    email: 'emeka.c@curantis.ng',
    phone: '+2348044447777',
    fullName: 'Emeka Okonkwo',
    state: 'Lagos',
    lga: 'Surulere',
    careRecipientName: 'Pascal Okonkwo',
    careRecipientAge: 84,
    careRecipientRel: 'Grandfather',
    careNeedsSummary: 'Overnight assistance, bathroom assistance, and general mobility aid.',
    emergencyName: 'Chidinma Okonkwo',
    emergencyPhone: '+2348055558888',
  },
  {
    email: 'funke@curantis.ng',
    phone: '+2348055559999',
    fullName: 'Funke Akindele',
    state: 'Lagos',
    lga: 'Ikoyi',
    careRecipientName: 'Mrs. Grace Akindele',
    careRecipientAge: 69,
    careRecipientRel: 'Mother',
    careNeedsSummary: 'Post-knee replacement surgical wound dressing and physio exercise encouragement.',
    emergencyName: 'Femi Akindele',
    emergencyPhone: '+2348066660000',
  },
];

async function seedClients() {
  console.log('  → Client accounts & profiles (5 users)');
  const clientHash = await bcrypt.hash('Client1234!', HASH_COST);
  const clientsMap = new Map<string, string>(); // email -> userId

  for (const c of clientsData) {
    const user = await prisma.user.upsert({
      where: { email: c.email },
      update: {},
      create: {
        email: c.email,
        phone: c.phone,
        passwordHash: clientHash,
        role: Role.CLIENT,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        phoneVerified: true,
      },
    });

    clientsMap.set(c.email, user.id);

    await prisma.clientProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        fullName: c.fullName,
        state: c.state,
        lga: c.lga,
        careRecipientName: c.careRecipientName,
        careRecipientAge: c.careRecipientAge,
        careRecipientRel: c.careRecipientRel,
        careNeedsSummary: c.careNeedsSummary,
        emergencyName: c.emergencyName,
        emergencyPhone: c.emergencyPhone,
      },
    });
  }

  return clientsMap;
}

// ─── Health Workers & Students ─────────────────────────────────────────────

const hwWorkersData = [
  {
    email: 'hw@curantis.ng',
    phone: '+2348023456789',
    fullName: 'Amaka Eze',
    bio: 'Registered Nurse with 8 years of experience specialising in elderly care and post-surgical recovery. NMCN certified.',
    workerType: WorkerType.HW,
    yearsExperience: 8,
    hourlyRateKobo: BigInt(450_000), // ₦4,500/hr
    state: 'Lagos',
    lga: 'Lekki',
    languages: ['English', 'Igbo', 'Yoruba'],
    skills: ['Wound Care', 'IV Therapy', 'Medication Administration', 'Elderly Care'],
    verificationStatus: VerificationStatus.VERIFIED,
    avgRating: 4.9,
    reviewCount: 27,
    bankCode: '058', accountNumber: '0123456789', accountName: 'Amaka Eze',
  },
  {
    email: 'olumide@curantis.ng',
    phone: '+2348031112222',
    fullName: 'Dr. Olumide Johnson',
    bio: 'Physiotherapist and Clinical Caregiver with 10 years experience in stroke and orthopaedic rehabilitation.',
    workerType: WorkerType.HW,
    yearsExperience: 10,
    hourlyRateKobo: BigInt(600_000), // ₦6,000/hr
    state: 'Lagos',
    lga: 'Victoria Island',
    languages: ['English', 'Yoruba'],
    skills: ['Physiotherapy', 'Post-Hospital Care', 'Stroke Rehab', 'Mobility Training'],
    verificationStatus: VerificationStatus.VERIFIED,
    avgRating: 5.0,
    reviewCount: 42,
    bankCode: '011', accountNumber: '0234567890', accountName: 'Olumide Johnson',
  },
  {
    email: 'blessing@curantis.ng',
    phone: '+2348042223333',
    fullName: 'Blessing Nnamdi',
    bio: 'Certified Intensive Care Nurse with expertise in tracheostomy care, catheter management, and elderly support.',
    workerType: WorkerType.HW,
    yearsExperience: 6,
    hourlyRateKobo: BigInt(500_000), // ₦5,000/hr
    state: 'Lagos',
    lga: 'Surulere',
    languages: ['English', 'Igbo'],
    skills: ['Catheter Care', 'Tracheostomy Care', 'Elderly Care', 'Nursing Care'],
    verificationStatus: VerificationStatus.VERIFIED,
    avgRating: 4.8,
    reviewCount: 19,
    bankCode: '057', accountNumber: '0345678901', accountName: 'Blessing Nnamdi',
  },
  {
    email: 'kemi@curantis.ng',
    phone: '+2348053334444',
    fullName: 'Kemi Balogun',
    bio: 'Community Health Extension Worker (CHEW) with 5 years experience in pediatric special needs and elderly companion care.',
    workerType: WorkerType.HW,
    yearsExperience: 5,
    hourlyRateKobo: BigInt(400_000), // ₦4,000/hr
    state: 'Lagos',
    lga: 'Ikeja',
    languages: ['English', 'Yoruba', 'Hausa'],
    skills: ['Special Needs Care', 'Pediatric Support', 'Medication Reminders', 'Companion Care'],
    verificationStatus: VerificationStatus.VERIFIED,
    avgRating: 4.7,
    reviewCount: 15,
    bankCode: '214', accountNumber: '0456789012', accountName: 'Kemi Balogun',
  },
  {
    email: 'chidi@curantis.ng',
    phone: '+2348064445555',
    fullName: 'Chidi Anozie',
    bio: 'General Nurse practitioner specializing in palliative care and diabetic foot management.',
    workerType: WorkerType.HW,
    yearsExperience: 4,
    hourlyRateKobo: BigInt(380_000), // ₦3,800/hr
    state: 'Lagos',
    lga: 'Yaba',
    languages: ['English', 'Igbo'],
    skills: ['Diabetic Care', 'Palliative Care', 'Wound Dressing'],
    verificationStatus: VerificationStatus.PENDING,
    avgRating: 0,
    reviewCount: 0,
    bankCode: '033', accountNumber: '0567890123', accountName: 'Chidi Anozie',
  },
];

const hsWorkersData = [
  {
    email: 'hs@curantis.ng',
    phone: '+2348034567890',
    fullName: 'Emeka Nwosu',
    bio: 'Final-year Nursing student at UNILAG. Passionate about elderly companionship and special needs assistance.',
    workerType: WorkerType.HS,
    yearsExperience: 1,
    institution: 'University of Lagos',
    gradYear: 2026,
    fieldOfStudy: 'Nursing Science',
    hourlyRateKobo: BigInt(250_000), // ₦2,500/hr
    state: 'Lagos',
    lga: 'Yaba',
    languages: ['English', 'Igbo'],
    skills: ['Elderly Care', 'Special Needs Support', 'Companionship'],
    verificationStatus: VerificationStatus.PENDING,
    avgRating: 0,
    reviewCount: 0,
    bankCode: '058', accountNumber: '0678901234', accountName: 'Emeka Nwosu',
  },
  {
    email: 'fatima@curantis.ng',
    phone: '+2348075556666',
    fullName: 'Fatima Aliyu',
    bio: '3rd year Medical Student at LASUCOM. Experienced in home companionship and health monitoring.',
    workerType: WorkerType.HS,
    yearsExperience: 2,
    institution: 'Lagos State University College of Medicine',
    gradYear: 2027,
    fieldOfStudy: 'Medicine & Surgery',
    hourlyRateKobo: BigInt(280_000), // ₦2,800/hr
    state: 'Lagos',
    lga: 'Surulere',
    languages: ['English', 'Hausa', 'Yoruba'],
    skills: ['Elderly Care', 'Vital Signs Monitoring', 'Medication Reminders'],
    verificationStatus: VerificationStatus.VERIFIED,
    avgRating: 4.9,
    reviewCount: 11,
    bankCode: '011', accountNumber: '0789012345', accountName: 'Fatima Aliyu',
  },
  {
    email: 'tunde@curantis.ng',
    phone: '+2348086667777',
    fullName: 'Tunde Oladipo',
    bio: 'Physiotherapy Intern at LUTH. Skilled in passive movement exercises and elder mobility aid.',
    workerType: WorkerType.HS,
    yearsExperience: 1,
    institution: 'Lagos University Teaching Hospital',
    gradYear: 2026,
    fieldOfStudy: 'Physiotherapy',
    hourlyRateKobo: BigInt(220_000), // ₦2,200/hr
    state: 'Lagos',
    lga: 'Ikeja',
    languages: ['English', 'Yoruba'],
    skills: ['Physiotherapy Assist', 'Mobility Support', 'Exercise Aid'],
    verificationStatus: VerificationStatus.VERIFIED,
    avgRating: 4.6,
    reviewCount: 8,
    bankCode: '057', accountNumber: '0890123456', accountName: 'Tunde Oladipo',
  },
];

async function seedWorkers() {
  console.log('  → Health Workers & Students accounts (8 workers)');
  const workerHash = await bcrypt.hash('Worker1234!', HASH_COST);
  const workersMap = new Map<string, { userId: string; profileId: string }>();

  const allWorkers = [...hwWorkersData, ...hsWorkersData];

  for (const w of allWorkers) {
    const user = await prisma.user.upsert({
      where: { email: w.email },
      update: {},
      create: {
        email: w.email,
        phone: w.phone,
        passwordHash: workerHash,
        role: w.workerType === WorkerType.HW ? Role.HW : Role.HS,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        phoneVerified: true,
      },
    });

    const profile = await prisma.workerProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        fullName: w.fullName,
        bio: w.bio,
        workerType: w.workerType,
        yearsExperience: w.yearsExperience,
        institution: 'institution' in w ? w.institution : undefined,
        gradYear: 'gradYear' in w ? w.gradYear : undefined,
        fieldOfStudy: 'fieldOfStudy' in w ? w.fieldOfStudy : undefined,
        hourlyRateKobo: w.hourlyRateKobo,
        state: w.state,
        lga: w.lga,
        languages: w.languages,
        skills: w.skills,
        isAvailable: true,
        verificationStatus: w.verificationStatus,
        avgRating: w.avgRating,
        reviewCount: w.reviewCount,
      },
    });

    workersMap.set(w.email, { userId: user.id, profileId: profile.id });

    // Seed Bank Account
    await prisma.bankAccount.upsert({
      where: { workerId_accountNumber: { workerId: profile.id, accountNumber: w.accountNumber } },
      update: {},
      create: {
        workerId: profile.id,
        bankCode: w.bankCode,
        accountNumber: w.accountNumber,
        accountName: w.accountName,
        isDefault: true,
        verified: true,
      },
    });

    // Seed Availability Slots (Mon–Fri 08:00–18:00, Sat 09:00–15:00)
    await prisma.availabilitySlot.deleteMany({ where: { workerId: profile.id } });
    await prisma.availabilitySlot.createMany({
      data: [
        { workerId: profile.id, dayOfWeek: 1, startTime: '08:00', endTime: '18:00' },
        { workerId: profile.id, dayOfWeek: 2, startTime: '08:00', endTime: '18:00' },
        { workerId: profile.id, dayOfWeek: 3, startTime: '08:00', endTime: '18:00' },
        { workerId: profile.id, dayOfWeek: 4, startTime: '08:00', endTime: '18:00' },
        { workerId: profile.id, dayOfWeek: 5, startTime: '08:00', endTime: '18:00' },
        { workerId: profile.id, dayOfWeek: 6, startTime: '09:00', endTime: '15:00' },
      ],
    });

    // Seed Availability Block (1 leave block in next 30 days)
    await prisma.availabilityBlock.deleteMany({ where: { workerId: profile.id } });
    await prisma.availabilityBlock.create({
      data: {
        workerId: profile.id,
        startDate: daysFromNow(20),
        endDate: daysFromNow(22),
        reason: 'Personal Leave / Training Workshop',
      },
    });

    // Seed Verifications & Credentials
    await prisma.verification.upsert({
      where: { id: `seed-verif-${w.email}` },
      update: {},
      create: {
        id: `seed-verif-${w.email}`,
        userId: user.id,
        nin: '12345678901',
        idDocUrl: `https://example.com/docs/${user.id}-id.jpg`,
        selfieUrl: `https://example.com/docs/${user.id}-selfie.jpg`,
        status: w.verificationStatus,
        reviewedBy: w.verificationStatus === VerificationStatus.VERIFIED ? 'verifier@curantis.ng' : undefined,
        reviewedAt: w.verificationStatus === VerificationStatus.VERIFIED ? daysAgo(10) : undefined,
      },
    });

    if (w.workerType === WorkerType.HW) {
      await prisma.credential.upsert({
        where: { id: `seed-cred-${w.email}` },
        update: {},
        create: {
          id: `seed-cred-${w.email}`,
          workerId: profile.id,
          title: 'Registered Nursing License',
          issuingBody: 'Nursing and Midwifery Council of Nigeria',
          licenceNumber: `NMCN/RN/${2020 + Math.floor(Math.random() * 4)}/${Math.floor(100000 + Math.random() * 900000)}`,
          documentUrl: `https://example.com/docs/${user.id}-license.pdf`,
          expiresAt: daysFromNow(365),
          status: w.verificationStatus === VerificationStatus.VERIFIED ? CredentialStatus.VERIFIED : CredentialStatus.PENDING,
        },
      });
    }
  }

  return workersMap;
}

// ─── Bookings, Payments, Reviews, Chats, Reports ─────────────────────────────

async function seedBookingsAndActivity(
  clientsMap: Map<string, string>,
  workersMap: Map<string, { userId: string; profileId: string }>,
) {
  console.log('  → Bookings, Payments, Reviews, Chat Messages & Reports (60-day timeline)');

  const elderlyCare = await prisma.serviceCategory.findUnique({ where: { name: 'Elderly Care' } });
  const postHospital = await prisma.serviceCategory.findUnique({ where: { name: 'Post-Hospital Care' } });
  const physio = await prisma.serviceCategory.findUnique({ where: { name: 'Physiotherapy Assist' } });
  const specialNeeds = await prisma.serviceCategory.findUnique({ where: { name: 'Special Needs Care' } });

  const clientNgozi = clientsMap.get('client@curantis.ng')!;
  const clientBabatunde = clientsMap.get('babatunde@curantis.ng')!;
  const clientAmina = clientsMap.get('amina@curantis.ng')!;
  const clientEmeka = clientsMap.get('emeka.c@curantis.ng')!;

  const hwAmaka = workersMap.get('hw@curantis.ng')!;
  const hwOlumide = workersMap.get('olumide@curantis.ng')!;
  const hsFatima = workersMap.get('fatima@curantis.ng')!;
  const hwBlessing = workersMap.get('blessing@curantis.ng')!;

  // 1. PAST COMPLETED BOOKING (-15 days ago)
  const b1Start = daysAgo(15);
  b1Start.setHours(9, 0, 0, 0);
  const b1End = new Date(b1Start.getTime() + 4 * 3_600_000);
  const rate1 = BigInt(450_000); // ₦4,500/hr
  const total1 = rate1 * 4n;
  const fee1 = total1 / 10n;

  const b1 = await prisma.booking.create({
    data: {
      clientId: clientNgozi,
      workerId: hwAmaka.userId,
      categoryId: elderlyCare!.id,
      status: BookingStatus.COMPLETED,
      careAddress: 'Block 4, Flat 2, VI Towers, Victoria Island, Lagos',
      careRequirements: 'Morning medication reminders and mobility assistance for Chief Okafor.',
      scheduledStart: b1Start,
      scheduledEnd: b1End,
      actualStart: b1Start,
      actualEnd: b1End,
      durationHours: 4.0,
      hourlyRateKobo: rate1,
      totalAmountKobo: total1,
      platformFeeKobo: fee1,
      workerAmountKobo: total1 - fee1,
      escrowReleaseAt: daysAgo(14),
    },
  });

  await prisma.payment.create({
    data: {
      bookingId: b1.id,
      clientId: clientNgozi,
      amountKobo: total1,
      gateway: PaymentGateway.PAYSTACK,
      gatewayRef: `pstk_ref_b1_${Date.now()}`,
      status: PaymentStatus.SUCCESSFUL,
      paidAt: daysAgo(16),
    },
  });

  await prisma.review.create({
    data: {
      bookingId: b1.id,
      clientId: clientNgozi,
      workerId: hwAmaka.userId,
      rating: 5,
      body: 'Nurse Amaka was exceptionally patient and attentive to my father. Highly recommended!',
      status: ReviewStatus.PUBLISHED,
    },
  });

  const conv1 = await prisma.conversation.create({
    data: {
      bookingId: b1.id,
      participantA: clientNgozi,
      participantB: hwAmaka.userId,
    },
  });

  await prisma.message.createMany({
    data: [
      { conversationId: conv1.id, senderId: clientNgozi, text: 'Hello Nurse Amaka, please remember to check my father’s BP on arrival.', createdAt: daysAgo(15) },
      { conversationId: conv1.id, senderId: hwAmaka.userId, text: 'Good morning ma! Noted. I am on my way to Victoria Island now.', createdAt: daysAgo(15) },
      { conversationId: conv1.id, senderId: hwAmaka.userId, text: 'I have arrived and completed the morning check. BP is 128/82.', createdAt: daysAgo(15) },
      { conversationId: conv1.id, senderId: clientNgozi, text: 'Wonderful! Thank you so much.', createdAt: daysAgo(15) },
    ],
  });

  // 2. PAST COMPLETED BOOKING (-7 days ago)
  const b2Start = daysAgo(7);
  b2Start.setHours(10, 0, 0, 0);
  const b2End = new Date(b2Start.getTime() + 3 * 3_600_000);
  const rate2 = BigInt(600_000);
  const total2 = rate2 * 3n;
  const fee2 = total2 / 10n;

  const b2 = await prisma.booking.create({
    data: {
      clientId: clientBabatunde,
      workerId: hwOlumide.userId,
      categoryId: physio!.id,
      status: BookingStatus.COMPLETED,
      careAddress: '14 Allen Avenue, Ikeja, Lagos',
      careRequirements: 'Post-stroke gait training and upper limb exercises for Mrs. Adeleke.',
      scheduledStart: b2Start,
      scheduledEnd: b2End,
      actualStart: b2Start,
      actualEnd: b2End,
      durationHours: 3.0,
      hourlyRateKobo: rate2,
      totalAmountKobo: total2,
      platformFeeKobo: fee2,
      workerAmountKobo: total2 - fee2,
      escrowReleaseAt: daysAgo(6),
    },
  });

  await prisma.payment.create({
    data: {
      bookingId: b2.id,
      clientId: clientBabatunde,
      amountKobo: total2,
      gateway: PaymentGateway.FLUTTERWAVE,
      gatewayRef: `flw_ref_b2_${Date.now()}`,
      status: PaymentStatus.SUCCESSFUL,
      paidAt: daysAgo(8),
    },
  });

  await prisma.review.create({
    data: {
      bookingId: b2.id,
      clientId: clientBabatunde,
      workerId: hwOlumide.userId,
      rating: 5,
      body: 'Dr. Olumide is outstanding. My mother showed visible improvement after just one session.',
      status: ReviewStatus.PUBLISHED,
    },
  });

  // 3. CURRENT ACTIVE BOOKING (IN_PROGRESS today)
  const b3Start = hoursAgo(1);
  const b3End = hoursFromNow(3);
  const rate3 = BigInt(450_000);
  const total3 = rate3 * 4n;

  const b3 = await prisma.booking.create({
    data: {
      clientId: clientNgozi,
      workerId: hwAmaka.userId,
      categoryId: elderlyCare!.id,
      status: BookingStatus.IN_PROGRESS,
      careAddress: 'Block 4, Flat 2, VI Towers, Victoria Island, Lagos',
      careRequirements: 'Afternoon care and companionship for Chief Okafor.',
      scheduledStart: b3Start,
      scheduledEnd: b3End,
      actualStart: b3Start,
      durationHours: 4.0,
      hourlyRateKobo: rate3,
      totalAmountKobo: total3,
      platformFeeKobo: total3 / 10n,
      workerAmountKobo: total3 - (total3 / 10n),
    },
  });

  await prisma.payment.create({
    data: {
      bookingId: b3.id,
      clientId: clientNgozi,
      amountKobo: total3,
      gateway: PaymentGateway.PAYSTACK,
      gatewayRef: `pstk_ref_b3_${Date.now()}`,
      status: PaymentStatus.SUCCESSFUL,
      paidAt: daysAgo(1),
    },
  });

  const conv3 = await prisma.conversation.create({
    data: {
      bookingId: b3.id,
      participantA: clientNgozi,
      participantB: hwAmaka.userId,
    },
  });

  await prisma.message.createMany({
    data: [
      { conversationId: conv3.id, senderId: hwAmaka.userId, text: 'I have arrived and Chief Okafor is currently having lunch.', createdAt: hoursAgo(1) },
      { conversationId: conv3.id, senderId: clientNgozi, text: 'Thank you Amaka! Please let him rest after lunch.', createdAt: hoursAgo(1) },
    ],
  });

  // 4. FUTURE CONFIRMED BOOKING (+3 days from now)
  const b4Start = daysFromNow(3);
  b4Start.setHours(9, 0, 0, 0);
  const b4End = new Date(b4Start.getTime() + 5 * 3_600_000);
  const rate4 = BigInt(280_000);
  const total4 = rate4 * 5n;

  const b4 = await prisma.booking.create({
    data: {
      clientId: clientAmina,
      workerId: hsFatima.userId,
      categoryId: specialNeeds!.id,
      status: BookingStatus.CONFIRMED,
      careAddress: '12 Admiralty Way, Lekki Phase 1, Lagos',
      careRequirements: 'Sensory games and reading companion for 6-year-old Zainab.',
      scheduledStart: b4Start,
      scheduledEnd: b4End,
      durationHours: 5.0,
      hourlyRateKobo: rate4,
      totalAmountKobo: total4,
      platformFeeKobo: total4 / 10n,
      workerAmountKobo: total4 - (total4 / 10n),
    },
  });

  await prisma.payment.create({
    data: {
      bookingId: b4.id,
      clientId: clientAmina,
      amountKobo: total4,
      gateway: PaymentGateway.PAYSTACK,
      gatewayRef: `pstk_ref_b4_${Date.now()}`,
      status: PaymentStatus.SUCCESSFUL,
      paidAt: daysAgo(1),
    },
  });

  // 5. FUTURE PENDING BOOKING (+7 days from now)
  const b5Start = daysFromNow(7);
  b5Start.setHours(14, 0, 0, 0);
  const b5End = new Date(b5Start.getTime() + 4 * 3_600_000);
  const rate5 = BigInt(500_000);
  const total5 = rate5 * 4n;

  await prisma.booking.create({
    data: {
      clientId: clientEmeka,
      workerId: hwBlessing.userId,
      categoryId: postHospital!.id,
      status: BookingStatus.PENDING,
      careAddress: '55 Bode Thomas Street, Surulere, Lagos',
      careRequirements: 'Catheter check and wound dressing after hospital discharge.',
      scheduledStart: b5Start,
      scheduledEnd: b5End,
      durationHours: 4.0,
      hourlyRateKobo: rate5,
      totalAmountKobo: total5,
      platformFeeKobo: total5 / 10n,
      workerAmountKobo: total5 - (total5 / 10n),
    },
  });

  // 6. DISPUTED BOOKING (-3 days ago) & REPORT
  const b6Start = daysAgo(3);
  b6Start.setHours(8, 0, 0, 0);
  const b6End = new Date(b6Start.getTime() + 4 * 3_600_000);
  const rate6 = BigInt(450_000);
  const total6 = rate6 * 4n;

  const b6 = await prisma.booking.create({
    data: {
      clientId: clientBabatunde,
      workerId: hwAmaka.userId,
      categoryId: elderlyCare!.id,
      status: BookingStatus.DISPUTED,
      careAddress: '14 Allen Avenue, Ikeja, Lagos',
      careRequirements: 'Morning care shift for Mrs. Adeleke.',
      scheduledStart: b6Start,
      scheduledEnd: b6End,
      actualStart: b6Start,
      actualEnd: new Date(b6Start.getTime() + 2 * 3_600_000), // Left 2 hours early
      durationHours: 4.0,
      hourlyRateKobo: rate6,
      totalAmountKobo: total6,
      platformFeeKobo: total6 / 10n,
      workerAmountKobo: total6 - (total6 / 10n),
    },
  });

  await prisma.payment.create({
    data: {
      bookingId: b6.id,
      clientId: clientBabatunde,
      amountKobo: total6,
      gateway: PaymentGateway.FLUTTERWAVE,
      gatewayRef: `flw_ref_b6_${Date.now()}`,
      status: PaymentStatus.SUCCESSFUL,
      paidAt: daysAgo(4),
    },
  });

  await prisma.report.create({
    data: {
      bookingId: b6.id,
      reporterId: clientBabatunde,
      accusedId: hwAmaka.userId,
      category: 'Tardiness & Early Departure',
      description: 'Caregiver left 2 hours before the agreed end time without notice.',
      status: 'OPEN',
    },
  });

  // 7. RESOLVED REPORT (historic dispute)
  await prisma.report.create({
    data: {
      reporterId: clientAmina,
      accusedId: hsFatima.userId,
      category: 'Billing Query',
      description: 'Inquired about partial refund for extra hours booked.',
      status: 'RESOLVED',
      outcome: 'Support explained platform policy and client accepted partial credit voucher.',
    },
  });
}

// ─── Clean Database ──────────────────────────────────────────────────────────

async function cleanDatabase() {
  console.log('  → Cleaning existing database records...');
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.report.deleteMany({});
  await prisma.review.deleteMany({});
  await prisma.refund.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.bookingLog.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.availabilityBlock.deleteMany({});
  await prisma.availabilitySlot.deleteMany({});
  await prisma.credential.deleteMany({});
  await prisma.verification.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.adminLog.deleteMany({});
  await prisma.adminProfile.deleteMany({});
  await prisma.clientProfile.deleteMany({});
  await prisma.workerProfile.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.serviceCategory.deleteMany({});
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding Curantis database for past & next 2 months...\n');

  await cleanDatabase();
  await seedCategories();
  await seedAdmins();
  const clientsMap = await seedClients();
  const workersMap = await seedWorkers();
  await seedBookingsAndActivity(clientsMap, workersMap);

  console.log('\nSeeding complete! 🚀\n');
  console.log('Dev Accounts Summary:');
  console.log('  admin@curantis.ng       Admin1234!   (SUPER_ADMIN)');
  console.log('  verifier@curantis.ng    Admin1234!   (VERIFICATION_OFFICER)');
  console.log('  support@curantis.ng     Admin1234!   (SUPPORT_AGENT)');
  console.log('  finance@curantis.ng     Admin1234!   (FINANCE_OFFICER)');
  console.log('  client@curantis.ng      Client1234!  (CLIENT - Ngozi Okafor)');
  console.log('  babatunde@curantis.ng   Client1234!  (CLIENT - Babatunde Adeleke)');
  console.log('  hw@curantis.ng          Worker1234!  (HW - Amaka Eze, VERIFIED, ₦4,500/hr)');
  console.log('  olumide@curantis.ng     Worker1234!  (HW - Dr. Olumide Johnson, VERIFIED, ₦6,000/hr)');
  console.log('  hs@curantis.ng          Worker1234!  (HS - Emeka Nwosu, PENDING, ₦2,500/hr)');
  console.log('  fatima@curantis.ng      Worker1234!  (HS - Fatima Aliyu, VERIFIED, ₦2,800/hr)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
