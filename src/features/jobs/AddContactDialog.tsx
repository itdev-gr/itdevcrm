import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useUpdateClientAdditionalContacts,
  type AdditionalContact,
} from '@/features/clients/hooks/useUpdateClientAdditionalContacts';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  existing: AdditionalContact[];
};

const EMPTY: AdditionalContact = { full_name: '', email: '', phone: '', info: '' };

export function AddContactDialog({ open, onOpenChange, clientId, existing }: Props) {
  const upd = useUpdateClientAdditionalContacts();
  const [row, setRow] = useState<AdditionalContact>(EMPTY);

  useEffect(() => {
    if (open) setRow({ ...EMPTY });
  }, [open]);

  async function onSave() {
    if (!row.full_name.trim() && !row.email.trim() && !row.phone.trim()) {
      // Nothing to save
      return;
    }
    await upd.mutateAsync({
      clientId,
      contacts: [
        ...existing,
        {
          full_name: row.full_name.trim(),
          email: row.email.trim(),
          phone: row.phone.trim(),
          info: row.info.trim(),
        },
      ],
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="ac-name">Full name</Label>
            <Input
              id="ac-name"
              value={row.full_name}
              onChange={(e) => setRow({ ...row, full_name: e.target.value })}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="ac-email">Email</Label>
            <Input
              id="ac-email"
              type="email"
              value={row.email}
              onChange={(e) => setRow({ ...row, email: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ac-phone">Phone</Label>
            <Input
              id="ac-phone"
              value={row.phone}
              onChange={(e) => setRow({ ...row, phone: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="ac-info">Info</Label>
            <Input
              id="ac-info"
              value={row.info}
              onChange={(e) => setRow({ ...row, info: e.target.value })}
              placeholder="e.g. CFO · best after 5pm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={
              upd.isPending ||
              (!row.full_name.trim() && !row.email.trim() && !row.phone.trim())
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
