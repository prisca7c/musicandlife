import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link href="/register" className="text-sm text-[var(--sage)] hover:underline">← Back to registration</Link>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-8 prose prose-sm max-w-none">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Music &amp; Life — Terms &amp; Conditions</h1>
          <p className="text-sm text-gray-400 mb-8">Pinner, Greater London · 2025-26</p>

          {/* §1 */}
          <h2 className="text-lg font-semibold mt-8 mb-3">1. Fees &amp; Payment Terms</h2>
          <p className="text-sm text-gray-500 mb-3">
            <em>Please note: We do not offer free trial sessions. Lesson fees are subject to change. We reserve the right to adjust tuition, and we will notify families of any changes in advance.</em>
          </p>
          <p className="text-sm text-gray-700 mb-3">
            To continue investing in our expert tutors and studio resources, our fees for the upcoming year are as follows. Payments are structured by the school term, and we are pleased to offer a <strong>5% discount</strong> for families who pay for the whole term in advance.
          </p>

          <h3 className="text-sm font-semibold text-gray-800 mb-2">Lesson Rates</h3>
          <table className="w-full text-sm mb-4 border rounded overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Lesson</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Per session</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr><td className="px-3 py-2">Individual 30-min</td><td className="px-3 py-2 text-right font-medium">£35.00</td></tr>
              <tr><td className="px-3 py-2">Individual 45-min</td><td className="px-3 py-2 text-right font-medium">£52.50</td></tr>
              <tr><td className="px-3 py-2">Individual 60-min</td><td className="px-3 py-2 text-right font-medium">£70.00</td></tr>
              <tr><td className="px-3 py-2">Group 60-min</td><td className="px-3 py-2 text-right font-medium">£25.00</td></tr>
            </tbody>
          </table>

          <p className="text-sm text-gray-700 mb-2">
            <strong>Joining Mid-Term:</strong> You are welcome to join at any point during the year. Your term fee will be calculated based on the number of lessons remaining (e.g., if you join in week 3 of a 12-week term, you will pay for 10 lessons).
          </p>

          <p className="text-sm text-gray-700 mb-2">
            <strong>Suzuki Violin Package:</strong> This package includes 5 bi-weekly one-hour group lessons each term.
            Term £520 (after 5% discount: Autumn &amp; Summer term: £494, Spring term: £452.85).
          </p>

          <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-2">Payment Methods</h3>
          <p className="text-sm text-gray-700 mb-2">Lessons cannot begin until payment for the term has been made. We accept bank transfer or cash payments.</p>
          <p className="text-sm text-gray-700 mb-2">
            <strong>Convenient Monthly Plan:</strong> For families who prefer to spread the cost, we offer a monthly direct debit plan that spreads the cost of 35 lessons over 11 months (Sept–July). Please note, the 5% discount does not apply to this plan. For example, a 30-minute lesson would be £111.36 per month. Please speak with us to arrange this.
          </p>

          {/* §2 */}
          <h2 className="text-lg font-semibold mt-8 mb-3">2. Lesson Scheduling &amp; Cancellation Policy</h2>
          <p className="text-sm text-gray-700 mb-2">We understand that life can be busy. Our policy is designed to be fair to both our families and our instructors.</p>
          <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5 mb-3">
            <li><strong>24-Hour Cancellation Notice:</strong> Please provide at least 24 hours' notice via email or phone to cancel or reschedule a lesson. This applies to all reasons for cancellation, including illness.</li>
            <li><strong>Cancellations with 24+ Hours' Notice:</strong> You will receive a make-up credit, which can be used to reschedule the lesson.</li>
            <li>
              <strong>Cancellations with Less Than 24 Hours' Notice:</strong> The teacher is not obligated to reschedule. However, we offer:
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li><strong>Send a video</strong> — You can send a video of your practice to your teacher, who will review it during your scheduled lesson time and provide feedback.</li>
                <li><strong>Switch to an online lesson</strong> — Where feasible, you can opt to have your lesson online instead.</li>
              </ul>
            </li>
            <li><strong>Missed Lessons (No Notice):</strong> If a lesson is missed without any prior notice, it will be forfeited, and no refund or credit will be issued.</li>
          </ul>

          {/* §3 */}
          <h2 className="text-lg font-semibold mt-8 mb-3">3. Make-Up Lessons &amp; Teacher Absences</h2>
          <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5 mb-3">
            <li><strong>Student Make-Up Lessons:</strong> Make-up lessons are offered when a cancellation is made with at least 24 hours' notice. Make-up credits are valid for <strong>30 days</strong> from the date of the original lesson, unless your teacher agrees to an extension. While we do our best to find an alternative time, make-up lessons are not guaranteed and are subject to schedule availability.</li>
            <li><strong>Teacher Cancellations:</strong> If a teacher must cancel a lesson, they are obligated to either reschedule at a mutually convenient time or issue a make-up credit. A replacement teacher may be arranged if necessary.</li>
          </ul>

          {/* §4 */}
          <h2 className="text-lg font-semibold mt-8 mb-3">4. General Studio Policies</h2>
          <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5 mb-3">
            <li><strong>Punctuality:</strong> Please arrive on time for your lesson. Late arrivals will still finish at the scheduled time to respect the student following you. If a teacher is late, you will receive your full lesson time.</li>
            <li><strong>Serious Illness:</strong> We understand that serious or long-term illness can interfere with attendance. In such cases, please speak directly with your teacher to discuss special arrangements.</li>
            <li><strong>Discontinuing Lessons:</strong> Should your circumstances change and you need to discontinue lessons, we kindly request <strong>4 weeks' notice</strong> before the end of the term to allow us to adjust our schedules.</li>
            <li><strong>Our Positive Environment:</strong> We are committed to a safe, positive, and respectful environment for all students, parents, and teachers. We do not tolerate disrespectful or aggressive behaviour and reserve the right to terminate lessons at any time. In the rare event of termination, any unused lesson credits will be refunded.</li>
            <li><strong>Communication:</strong> We encourage open communication! Please feel free to ask any questions you may have about lessons, policies, or your child's progress.</li>
          </ul>

          {/* §5 */}
          <h2 className="text-lg font-semibold mt-8 mb-3">5. Lesson Term Dates 2025-26 <span className="font-normal text-gray-500">(35 lessons total)</span></h2>

          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">Autumn Term 2025 — 12 lessons</h3>
              <p className="text-sm text-gray-700">Monday 15 September – Saturday 13 December</p>
              <p className="text-sm text-gray-500">Half-term break: 27 Oct – 1 Nov</p>
              <p className="text-sm text-gray-500">Suzuki Violin Group: 4 Oct, 18 Oct, 8 Nov, 22 Nov, 6 Dec</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">Spring Term 2026 — 11 lessons</h3>
              <p className="text-sm text-gray-700">Monday 5 January – Saturday 28 March</p>
              <p className="text-sm text-gray-500">Half-term break: 16 Feb – 21 Feb</p>
              <p className="text-sm text-gray-500">Suzuki Violin Group: 17 Jan, 31 Jan, 14 Feb, 7 Mar, 21 Mar</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">Summer Term 2026 — 12 lessons</h3>
              <p className="text-sm text-gray-700">Monday 13 April – Saturday 11 July</p>
              <p className="text-sm text-gray-500">Half-term break: 25 May – 30 May</p>
              <p className="text-sm text-gray-500">Bank holiday note: Lessons on Monday 4 May will be moved to Monday 13 July.</p>
              <p className="text-sm text-gray-500">Suzuki Violin Group: 25 Apr, 9 May, 23 May, 13 Jun, 27 Jun</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
