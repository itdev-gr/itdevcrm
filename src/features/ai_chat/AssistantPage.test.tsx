import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssistantPage } from './AssistantPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

const conversations = vi.fn();
const messages = vi.fn();
const sendMutate = vi.fn();
const send = vi.fn();
vi.mock('./hooks/useAiChat', () => ({
  useAiConversations: () => conversations(),
  useAiMessages: () => messages(),
  useSendChatMessage: () => send(),
  useDeleteConversation: () => ({ mutate: vi.fn() }),
}));

describe('AssistantPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversations.mockReturnValue({ data: [] });
    messages.mockReturnValue({ data: [] });
    send.mockReturnValue({ mutate: sendMutate, isPending: false, isError: false });
  });

  it('shows the empty state with quick prompts', () => {
    render(<AssistantPage />);
    expect(screen.getByText('Ποιοι πελάτες είναι ληξιπρόθεσμοι;')).toBeInTheDocument();
    expect(screen.getByText('Τι πληρωμές λήγουν αυτή την εβδομάδα;')).toBeInTheDocument();
  });

  it('sends the typed question on Enter', () => {
    render(<AssistantPage />);
    const box = screen.getByRole('textbox', { name: 'Γράψε την ερώτησή σου…' });
    fireEvent.change(box, { target: { value: 'τι γίνεται με τον 000066;' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(sendMutate).toHaveBeenCalledWith(
      { conversationId: null, message: 'τι γίνεται με τον 000066;' },
      expect.anything(),
    );
  });

  it('renders user and assistant bubbles', () => {
    messages.mockReturnValue({
      data: [
        { id: '1', conversation_id: 'c', role: 'user', content: 'ερώτηση', tool_payload: null, created_at: 'x' },
        { id: '2', conversation_id: 'c', role: 'assistant', content: 'Ο πελάτης είναι **On Hold**', tool_payload: null, created_at: 'y' },
      ],
    });
    render(<AssistantPage />);
    expect(screen.getByText('ερώτηση')).toBeInTheDocument();
    expect(screen.getByText('On Hold')).toBeInTheDocument();
  });

  it('shows the thinking indicator while pending', () => {
    send.mockReturnValue({ mutate: sendMutate, isPending: true, isError: false });
    render(<AssistantPage />);
    expect(screen.getByText('Ψάχνω στα στοιχεία…')).toBeInTheDocument();
  });
});
