import { getDoctorById, getAvailableTimeSlots } from "@/actions/appointments";
import { DoctorProfile } from "./_components/doctor-profile";
import { redirect } from "next/navigation";

export default async function DoctorProfilePage({ params }) {
  // Ensure params is destructured correctly
  const { id, specialty } = await params; // ✅ FIXED

  console.log("Resolved params:", { id, specialty });
  try {
    const [doctorData, slotsData] = await Promise.all([
      getDoctorById(id),
      getAvailableTimeSlots(id),
    ]);

    if (!doctorData?.doctor) {
      redirect("/doctors");
    }

    return (
      <DoctorProfile
        doctor={doctorData.doctor}
        availableDays={slotsData.days || []}
      />
    );
  } catch (error) {
    console.error(`Error loading doctor profile for ID: ${id}`, error);
    redirect("/doctors");
  }
}
