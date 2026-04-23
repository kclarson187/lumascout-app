import { DashboardHeader } from '@/components/dashboard-parts';
import { ProductForm } from '../_form';

export const dynamic = 'force-dynamic';

export default function NewProductPage() {
  return (
    <>
      <DashboardHeader
        eyebrow="New listing"
        title="Create a product"
        kicker="Ship a preset pack, guide, or mentorship session. Admins review and approve before it goes live."
      />
      <div className="px-6 lg:px-10 pb-16">
        <ProductForm mode="create" />
      </div>
    </>
  );
}
