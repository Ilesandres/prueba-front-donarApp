import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DonationService, Donation, Comment, StatusDonation } from '../../../core/services/donation.service';
import { AuthService } from '../../../core/services/auth.service';
import { MessageService } from '../../../core/services/message.service';
import { HttpClient } from '@angular/common/http';
import { AlertService } from '../../../shared/services/alert.service';
import { environment } from '../../../../environments/environment';
import { AcknowledgmentFormComponent } from '../../../shared/components/acknowledgment-form/acknowledgment-form.component';
import { AcknowledgmentListComponent } from '../../../shared/components/acknowledgment-list/acknowledgment-list.component';

@Component({
  selector: 'app-donation-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, AcknowledgmentFormComponent, AcknowledgmentListComponent],
  templateUrl: './donation-detail.component.html',
  styleUrls: ['./donation-detail.component.scss']
})
export class DonationDetailComponent implements OnInit {
  donation: Donation | null = null;
  loading = false;
  errorMessage = '';
  canEditDonation = false;
  canDeleteDonation = false;
  canEditStatus = false;
  isBeneficiary = false;
  isDonator = false;
  // Note: chat list is shown in the global Sidebar component; donation-detail
  // only keeps the Create/Open chat actions.

  newReviewText = '';
  submittingReview = false;
  reviewError = '';

  allStatuses: StatusDonation[] = [];
  selectedStatusId: number = 0;
  updatingStatus = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private donationService: DonationService,
    public authService: AuthService,
    private location: Location,
    private http: HttpClient,
    private alertService: AlertService
    ,
    private messageService: MessageService
  ) { }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadDonation(parseInt(id));
      this.loadStatuses();
    } else {
      this.errorMessage = 'ID de donación no válido';
    }
  }

  private loadStatuses(): void {
    this.donationService.getAllDonationStatuses().subscribe({
      next: (statuses) => {
        this.allStatuses = statuses;
      },
      error: (error) => {
        console.error('Error al cargar estados:', error);
      }
    });
  }

  canAddReview(): boolean {
    if (!this.donation) return false;
    if (!this.isBeneficiary) return false;
    const currentUser = this.authService.currentUserValue;
    if (!currentUser) return false;

    const reviews = (this.donation.reviews || []);
    const already = reviews.some(r => String(r.user?.id) === String(currentUser.id));
    return !already;
  }

  addReview(): void {
    if (!this.donation) return;
    if (!this.canAddReview()) {
      this.reviewError = 'No puedes añadir otra valoración.';
      setTimeout(() => this.reviewError = '', 3000);
      return;
    }

    const text = (this.newReviewText || '').trim();
    if (!text) {
      this.reviewError = 'El comentario no puede estar vacío.';
      setTimeout(() => this.reviewError = '', 3000);
      return;
    }

    this.submittingReview = true;
    this.reviewError = '';

    const url = `${environment.apiBackendUrl}/donationreview/create`;
    const payload = {
      review: text,
      donationId: this.donation.id
    };

    this.http.post<any>(url, payload).subscribe({
      next: (created) => {
        const createdReview = created?.data ?? created?.review ?? created;

        if (!this.donation) return;
        if (!this.donation.reviews) this.donation.reviews = [];

        const currentUser = this.authService.currentUserValue;
        if (createdReview && createdReview.user && currentUser && String(createdReview.user.id) === String(currentUser.id)) {
          createdReview.user = {
            ...createdReview.user,
            username: createdReview.user.username || (currentUser as any).username
          } as Partial<any>;
        }

        this.donation.reviews = [...this.donation.reviews, createdReview];
        this.newReviewText = '';
        this.submittingReview = false;
        this.donationService.getDonationById(this.donation.id).subscribe({
          next: (fresh) => {
            this.donation = fresh;
            this.checkPermissions();
          },
          error: (err) => {
            console.warn('No se pudo refrescar la donación tras crear review:', err);
          }
        });
      },
      error: (err) => {
        console.error('Error al crear review:', err);
        this.submittingReview = false;
        if (err?.status === 403) {
          this.reviewError = 'No tienes permiso para agregar una valoración.';
        } else if (err?.status === 409) {
          this.reviewError = 'Ya existe una valoración desde este usuario.';
        } else if (err?.status === 0) {
          this.reviewError = 'Error de conexión. Verifica tu internet.';
        } else {
          this.reviewError = err?.error?.message || 'No se pudo agregar la valoración.';
        }
        setTimeout(() => this.reviewError = '', 4000);
      }
    });
  }

  private loadDonation(id: number): void {
    this.loading = true;
    this.errorMessage = '';

    this.donationService.getDonationById(id).subscribe({
      next: (donation) => {
        this.donation = donation;
        this.selectedStatusId = donation.statusDonation.id;
        this.loading = false;

        this.checkPermissions();
      },
      error: (error) => {
        this.loading = false;
        console.error('Error al cargar donación:', error);

        if (error.status === 404) {
          this.errorMessage = 'Donación no encontrada';
        } else if (error.status === 403) {
          this.errorMessage = 'No tienes permiso para ver esta donación';
        } else {
          this.errorMessage = 'Error al cargar la donación. Por favor intenta nuevamente.';
        }
      }
    });
  }


  private checkPermissions(): void {
    if (!this.donation) return;

    const currentUser = this.authService.currentUserValue;
    if (!currentUser) {
      this.canEditDonation = false;
      this.canDeleteDonation = false;
      this.canEditStatus = false;
      return;
    }

    const currentUserId = String(currentUser.id);
    const beneficiaryId = String(this.donation.beneficiary?.id);
    const donatorId = String(this.donation.donator?.id);

    const isBeneficiary = currentUserId === beneficiaryId;
    const isDonator = currentUserId === donatorId;
    const isOwner = this.donation.owner === true;
    this.isBeneficiary = isBeneficiary;
    this.isDonator = isDonator;

    const isPending = this.donation.statusDonation?.status?.toLowerCase() === 'pendiente';

    const currentStatus = this.donation.statusDonation?.status?.toLowerCase().trim() || '';
    const finalStatuses = ['entregada', 'completada', 'cancelada', 'rechazada'];
    const isFinalStatus = finalStatuses.includes(currentStatus);

    this.canEditDonation = isDonator && isPending;

    this.canDeleteDonation = isDonator;

    this.canEditStatus = (isDonator || isOwner) && !isBeneficiary && !isFinalStatus;
  }

  loadAcknowledgments(): void {
    // Este método se llama cuando se crea un nuevo agradecimiento
    // El componente AcknowledgmentListComponent se recargará automáticamente
    // No necesitamos hacer nada aquí ya que el componente maneja su propia carga
  }

  onEdit(): void {
    if (!this.donation) return;

    if (!this.canEditDonation) {
      const isPending = this.donation.statusDonation?.status?.toLowerCase() === 'pendiente';
      if (!isPending) {
        this.errorMessage = 'Solo se pueden editar donaciones en estado "pendiente".';
      } else {
        this.errorMessage = 'No tienes permiso para editar esta donación. Solo el beneficiario o donador pueden editarla.';
      }
      setTimeout(() => this.errorMessage = '', 4000);
      return;
    }

    this.router.navigate(['/organization/donations', this.donation.id, 'edit']);
  }

  onManageArticles(): void {
    if (!this.donation) return;

    if (!this.canEditDonation) {
      const isPending = this.donation.statusDonation?.status?.toLowerCase() === 'pendiente';
      if (!isPending) {
        this.errorMessage = 'Solo se pueden gestionar artículos en estado "pendiente".';
      } else {
        this.errorMessage = 'No tienes permiso para gestionar los artículos. Solo el beneficiario o donador pueden hacerlo.';
      }
      setTimeout(() => this.errorMessage = '', 4000);
      return;
    }

    this.router.navigate(['/organization/donations', this.donation.id, 'manage-articles']);
  }

  onDelete(): void {
    if (!this.donation) return;

    if (!this.canDeleteDonation) {
      this.errorMessage = 'No tienes permiso para eliminar esta donación. Solo el creador puede eliminarla.';
      setTimeout(() => this.errorMessage = '', 3000);
      return;
    }

    if (confirm('¿Estás seguro de eliminar esta donación? Esta acción no se puede deshacer.')) {
      this.loading = true;
      this.donationService.deleteDonation(this.donation.id).subscribe({
        next: () => {
          this.router.navigate(['/organization/donations']);
        },
        error: (error) => {
          this.loading = false;
          console.error('Error al eliminar:', error);

          if (error.status === 404) {
            this.errorMessage = 'La donación no existe o ya fue eliminada.';
          } else if (error.status === 403) {
            this.errorMessage = 'No tienes permiso para eliminar esta donación. Solo el creador puede eliminarla.';
          } else if (error.status === 409) {
            this.errorMessage = 'No se puede eliminar la donación porque tiene artículos asociados o está en proceso.';
          } else if (error.status === 500) {
            this.errorMessage = 'Error en el servidor al eliminar la donación. Intenta nuevamente más tarde.';
          } else if (error.status === 0) {
            this.errorMessage = 'Error de conexión. Verifica tu conexión a internet.';
          } else {
            this.errorMessage = 'Error al eliminar la donación. Por favor intenta nuevamente.';
          }
        }
      });
    }
  }
  async onExtendDate(): Promise<void> {
    if (!this.donation) return;

    const confirmed = await this.alertService.warning(
      'Extender fecha',
      '¿Deseas extender la fecha máxima de entrega en 10 días?',
      'Sí, extender',
      'Cancelar'
    );

    if (!confirmed) return;

    this.loading = true;
    const url = `${environment.apiBackendUrl}/donation/update-date/${this.donation.id}`;

    try {
      const updatedDonation = await new Promise<Donation>((resolve, reject) => {
        this.http.put<Donation>(url, {}).subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err)
        });
      });

      this.donation = updatedDonation;
      this.loading = false;
      await this.alertService.success('Fecha extendida', 'La fecha máxima de entrega se extendió exitosamente por 10 días más.');

    } catch (error: any) {
      this.loading = false;
      console.error('Error al extender fecha:', error);
      const title = 'No se pudo extender la fecha';
      const message = error?.error?.message || 'Esta donación ya fue extendida una vez o no es posible extenderla.';
      await this.alertService.error(title, message);
    }
  }

  onBack(): void {
    this.location.back();
  }

  onCreateChat(): void {
    if (!this.donation) return;
    if (!this.authService.currentUserValue) {
      this.alertService.showAlert('Debes iniciar sesión', 'info');
      return;
    }
    if (!this.isBeneficiary && !this.isDonator) {
      this.alertService.error('No permitido', 'Solo los participantes de esta donación pueden crear o abrir el chat.');
      return;
    }

    this.loading = true;
    this.messageService.createChatFromDonation(this.donation.id).subscribe({
      next: async (res) => {
        try {
          const fresh = await new Promise<Donation>((resolve, reject) => {
            this.donationService.getDonationById(this.donation!.id).subscribe({ next: d => resolve(d), error: e => reject(e) });
          });
          this.donation = fresh;
          this.checkPermissions();
          this.alertService.success('Chat creado', 'El chat se creó correctamente.');
        } catch (err) {
          console.warn('No se pudo refrescar la donación después de crear chat:', err);
          this.alertService.success('Chat creado', 'El chat se creó correctamente.');
        }
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        console.error('Error al crear chat desde donación:', err);
        const msg = err?.error?.message || 'No se pudo crear el chat. Intenta nuevamente.';
        this.alertService.error('Error', msg);
      }
    });
  }

  onOpenChat(): void {
    if (!this.donation || !this.donation.chat || !this.donation.chat.id) return;
 
    if (!this.authService.currentUserValue || (!this.isBeneficiary && !this.isDonator)) {
      this.alertService.error('No permitido', 'No tienes permiso para ver este chat.');
      return;
    }
    console.log('Navegando al chat ID:', this.donation.chat.id);
    
    this.router.navigate(['/chat'], { queryParams: { chat: this.donation.chat.id } });
  }

  formatDate(dateString: string): string {
    if (!dateString) return 'No especificado';

    // Si la fecha viene solo como "YYYY-MM-DD" (sin hora), formatearla directamente
    // para evitar problemas de zona horaria
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Formato solo fecha (YYYY-MM-DD), extraer componentes directamente
      const [year, month, day] = dateString.split('-').map(Number);
      // Usar Intl.DateTimeFormat con UTC para evitar cambios de zona horaria
      const date = new Date(Date.UTC(year, month - 1, day));
      return new Intl.DateTimeFormat('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
      }).format(date);
    } else {
      // Formato ISO completo, usar directamente
      const date = new Date(dateString);
      return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  }

  // Calcular días restantes
  getDaysRemaining(): number {
    if (!this.donation?.fechaMaximaEntrega) return 0;

    // Manejar correctamente las fechas que vienen del backend
    let maxDate: Date;
    const fechaString = this.donation.fechaMaximaEntrega;

    if (fechaString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Formato solo fecha (YYYY-MM-DD), crear en UTC para evitar cambios de fecha
      const [year, month, day] = fechaString.split('-').map(Number);
      maxDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    } else {
      // Formato ISO completo, usar directamente
      maxDate = new Date(fechaString);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Resetear horas para comparar solo fecha
    maxDate.setHours(0, 0, 0, 0); // Resetear horas para comparar solo fecha

    const diff = maxDate.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  // Obtener clase de estado
  getStatusClass(): string {
    const days = this.getDaysRemaining();
    if (days < 0) return 'expired';
    if (days <= 3) return 'urgent';
    if (days <= 7) return 'warning';
    return 'normal';
  }

  // Obtener comentarios como array
  getCommentsArray(): Comment[] {
    if (!this.donation?.comments) return [];
    if (Array.isArray(this.donation.comments)) {
      return this.donation.comments;
    }
    return [];
  }

  onStatusChange(): void {
    if (!this.donation || this.updatingStatus || !this.canEditStatus) return;

    this.updatingStatus = true;
    this.errorMessage = '';

    this.donationService.updateDonationStatus(this.donation.id, { status: this.selectedStatusId }).subscribe({
      next: (updatedDonation) => {
        this.donation = updatedDonation;
        this.selectedStatusId = updatedDonation.statusDonation.id;
        this.updatingStatus = false;
        this.checkPermissions();
      },
      error: (error) => {
        this.updatingStatus = false;
        console.error('Error al actualizar estado:', error);

        if (error.status === 404) {
          this.errorMessage = 'Donación no encontrada';
        } else if (error.status === 403) {
          this.errorMessage = 'No tienes permiso para actualizar el estado';
        } else {
          this.errorMessage = 'Error al actualizar el estado';
        }

        if (this.donation) {
          this.selectedStatusId = this.donation.statusDonation.id;
        }
      }
    });
  }
}
