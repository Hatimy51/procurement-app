import { render, screen } from '@testing-library/react';
import DocumentTemplate from '../DocumentTemplate';

const mockProps = {
  companyName: 'Acme Corp',
  createdBy: 'tester',
  updatedBy: null,
  // add other required props as needed
};

describe('DocumentTemplate', () => {
  test('renders created by line', () => {
    render(<DocumentTemplate {...mockProps} />);
    const auditLine = screen.getByText(/Created By:/i);
    expect(auditLine).toBeInTheDocument();
    expect(auditLine).toHaveTextContent('tester');
  });

  test('does not render updated by line when not provided', () => {
    render(<DocumentTemplate {...mockProps} />);
    const updatedLine = screen.queryByText(/Updated By:/i);
    expect(updatedLine).toBeNull();
  });
});
