"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { format } from "date-fns";

// Define credit allocations per plan
const PLAN_CREDITS = {
  free_user: 0,
  standard: 10,
  premium: 24,
};

const APPOINTMENT_CREDIT_COST = 2;

/**
 * Checks user's subscription and allocates monthly credits if needed
 * This should be called during layout or on login
 */
export async function checkAndAllocateCredits(user) {
  try {
    if (!user || user.role !== "PATIENT") return user;

    const { has } = await auth();

    const hasBasic = has({ plan: "free_user" });
    const hasStandard = has({ plan: "standard" });
    const hasPremium = has({ plan: "premium" });

    let currentPlan = null;
    let creditsToAllocate = 0;

    if (hasPremium) {
      currentPlan = "premium";
      creditsToAllocate = PLAN_CREDITS.premium;
    } else if (hasStandard) {
      currentPlan = "standard";
      creditsToAllocate = PLAN_CREDITS.standard;
    } else if (hasBasic) {
      currentPlan = "free_user";
      creditsToAllocate = PLAN_CREDITS.free_user;
    }

    if (!currentPlan) return user;

    const currentMonth = format(new Date(), "yyyy-MM");

    const latestTransaction = user.transactions?.[0];
    if (latestTransaction) {
      const transactionMonth = format(new Date(latestTransaction.createdAt), "yyyy-MM");
      const transactionPlan = latestTransaction.packageId;

      if (transactionMonth === currentMonth && transactionPlan === currentPlan) {
        return user; // Already allocated for this month
      }
    }

    const updatedUser = await db.$transaction(async (tx) => {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          amount: creditsToAllocate,
          type: "CREDIT_PURCHASE",
          packageId: currentPlan,
        },
      });

      return await tx.user.update({
        where: { id: user.id },
        data: {
          credits: {
            increment: creditsToAllocate,
          },
        },
      });
    }, { timeout: 10000 }); // ⏱️ Timeout for Prisma transaction

    revalidatePath("/doctors");
    revalidatePath("/appointments");

    return updatedUser;
  } catch (error) {
    console.error("❌ Error in checkAndAllocateCredits:", {
      message: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Deducts credits for booking an appointment
 */
export async function deductCreditsForAppointment(userId, doctorId) {
  try {
    const user = await db.user.findUnique({ where: { id: userId } });
    const doctor = await db.user.findUnique({ where: { id: doctorId } });

    if (!user) throw new Error("Patient not found");
    if (!doctor) throw new Error("Doctor not found");

    if (user.credits < APPOINTMENT_CREDIT_COST) {
      throw new Error("Insufficient credits to book an appointment");
    }

    const result = await db.$transaction(async (tx) => {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          amount: -APPOINTMENT_CREDIT_COST,
          type: "APPOINTMENT_DEDUCTION",
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId: doctor.id,
          amount: APPOINTMENT_CREDIT_COST,
          type: "APPOINTMENT_DEDUCTION",
        },
      });

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          credits: {
            decrement: APPOINTMENT_CREDIT_COST,
          },
        },
      });

      await tx.user.update({
        where: { id: doctor.id },
        data: {
          credits: {
            increment: APPOINTMENT_CREDIT_COST,
          },
        },
      });

      return updatedUser;
    }, { timeout: 10000 }); // ⏱️ Timeout for Prisma transaction

    return { success: true, user: result };
  } catch (error) {
    console.error("❌ Failed to deduct credits:", {
      message: error.message,
      stack: error.stack,
    });
    return { success: false, error: error.message };
  }
}
