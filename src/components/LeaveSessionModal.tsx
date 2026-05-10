interface Props {
	onLeave: () => void;
	onStay: () => void;
}

export default function LeaveSessionModal({ onLeave, onStay }: Props) {
	return (
		<>
			<div className="modal modal-container mid">
				<h3 className="mt05 mb05">Do you want to leave the session?</h3>
				<div style="display: flex; gap: 1em; justify-content: center; margin-top: 1em;">
					<button onClick={onLeave} className="primary">Leave session</button>
					<button onClick={onStay}>Stay</button>
				</div>
			</div>
			<div className="modal-overlay"></div>
		</>
	);
}
