interface Props {
	onReset: () => void;
}

export default function SessionManagementModal({ onReset }: Props) {
	return (
		<>
			<div className="modal modal-container mid">
				<h3 className="mt05 mb05">Session expired</h3>
				<p>
					Go to the homepage to start a new session or connect to another one.
				</p>
				<button onClick={onReset}>Homepage</button>
			</div>
			<div className="modal-overlay"></div>
		</>
	);
}
